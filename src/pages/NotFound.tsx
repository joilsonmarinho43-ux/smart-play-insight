import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Compass } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.warn("[404] Rota inexistente:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center max-w-sm">
        <Compass className="mx-auto mb-4 h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="mb-2 font-display text-5xl font-bold text-foreground">404</h1>
        <p className="mb-6 text-base text-muted-foreground">
          Página não encontrada. O endereço <span className="text-foreground">{location.pathname}</span> não existe.
        </p>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 font-bold text-primary-foreground transition hover:brightness-110"
        >
          Voltar ao Pré-Jogo
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
