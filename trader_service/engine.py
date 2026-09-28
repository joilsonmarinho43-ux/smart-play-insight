"""Conservative, deterministic signal filter. No order routing or price feed."""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import mean
from typing import Deque

MARKETS = {"WIN", "WDO", "NASDAQ", "OURO"}


@dataclass(frozen=True)
class Bar:
    market: str
    instrument: str
    end: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    source: str

    @classmethod
    def from_dict(cls, row: dict) -> "Bar":
        end = datetime.fromisoformat(row["end"].replace("Z", "+00:00"))
        if end.tzinfo is None:
            raise ValueError("end must include timezone")
        bar = cls(
            market=str(row["market"]).upper(), instrument=str(row["instrument"]),
            end=end, open=float(row["open"]), high=float(row["high"]),
            low=float(row["low"]), close=float(row["close"]),
            volume=float(row["volume"]), source=str(row["source"]),
        )
        if bar.market not in MARKETS or not bar.instrument or not bar.source:
            raise ValueError("unknown market or missing instrument/source")
        if min(bar.open, bar.high, bar.low, bar.close) <= 0 or bar.volume < 0:
            raise ValueError("non-positive price or negative volume")
        if bar.low > min(bar.open, bar.close) or bar.high < max(bar.open, bar.close):
            raise ValueError("inconsistent OHLC")
        return bar


class SignalEngine:
    """Processes closed 1-minute bars; signals are hypotheses, not tested alpha."""

    def __init__(self, max_age_seconds: int = 20, cooldown_minutes: int = 15):
        self.max_age_seconds = max_age_seconds
        self.cooldown_minutes = cooldown_minutes
        self.history: dict[str, Deque[Bar]] = defaultdict(lambda: deque(maxlen=240))
        self.last_signal: dict[str, datetime] = {}

    def process(self, bar: Bar, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise ValueError("now must include timezone")
        age = (now - bar.end).total_seconds()
        base = {"market": bar.market, "instrument": bar.instrument,
                "source": bar.source, "bar_end": bar.end.isoformat(),
                "age_seconds": round(age, 2)}
        if age < -5 or age > self.max_age_seconds:
            return {**base, "decision": "SEM_ENTRADA", "reason": "cotacao fora da janela de atualidade"}
        history = self.history[bar.market]
        if history and bar.instrument != history[-1].instrument:
            history.clear()  # Never join two expiry series without adjustment.
        if history and bar.end <= history[-1].end:
            return {**base, "decision": "SEM_ENTRADA", "reason": "barra duplicada ou fora de ordem"}
        history.append(bar)
        if len(history) < 35:
            return {**base, "decision": "AGUARDAR", "reason": "historico insuficiente"}
        bars = list(history)
        if any((b.end - a.end).total_seconds() != 60 for a, b in zip(bars[-35:-1], bars[-34:])):
            return {**base, "decision": "SEM_ENTRADA", "reason": "lacuna nos dados"}
        if any(b.volume <= 0 for b in bars[-20:]):
            return {**base, "decision": "SEM_ENTRADA", "reason": "volume ausente"}

        prev = bars[-21:-1]
        recent_high = max(b.high for b in prev)
        recent_low = min(b.low for b in prev)
        typical = [(b.high + b.low + b.close) / 3 for b in bars[-35:]]
        volume = [b.volume for b in bars[-35:]]
        vwap = sum(p * v for p, v in zip(typical, volume)) / sum(volume)
        true_ranges = [max(b.high - b.low, abs(b.high - p.close), abs(b.low - p.close))
                       for p, b in zip(bars[-15:-1], bars[-14:])]
        atr = mean(true_ranges)
        if atr <= 0:
            return {**base, "decision": "SEM_ENTRADA", "reason": "volatilidade invalida"}
        trend_up = mean(b.close for b in bars[-10:]) > mean(b.close for b in bars[-30:])
        trend_down = mean(b.close for b in bars[-10:]) < mean(b.close for b in bars[-30:])
        vol_ok = bar.volume >= 1.2 * mean(b.volume for b in prev)
        direction = None
        if bar.close > recent_high and bar.close > vwap and trend_up and vol_ok:
            direction = "COMPRA"
            stop = min(bar.low, bar.close - atr)
        elif bar.close < recent_low and bar.close < vwap and trend_down and vol_ok:
            direction = "VENDA"
            stop = max(bar.high, bar.close + atr)
        if not direction:
            return {**base, "decision": "AGUARDAR", "reason": "confluencias sem gatilho completo"}
        if bar.market in self.last_signal and (bar.end - self.last_signal[bar.market]).total_seconds() < 60 * self.cooldown_minutes:
            return {**base, "decision": "AGUARDAR", "reason": "intervalo entre alertas"}
        risk_points = abs(bar.close - stop)
        if risk_points <= 0 or risk_points > 2.5 * atr:
            return {**base, "decision": "SEM_ENTRADA", "reason": "stop desproporcional"}
        target = bar.close + (1.5 if direction == "COMPRA" else -1.5) * risk_points
        self.last_signal[bar.market] = bar.end
        return {**base, "decision": "CANDIDATA", "direction": direction,
                "trigger": "rompimento em fechamento de barra de 1 minuto",
                "reference_entry": bar.close, "stop": round(stop, 5),
                "target": round(target, 5), "risk_points": round(risk_points, 5),
                "reward_risk": 1.5, "vwap": round(vwap, 5), "atr": round(atr, 5),
                "warning": "Validar spread, noticias e preco atual antes de operar. Sem ordem automatica."}
