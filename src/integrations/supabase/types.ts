export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      active_sessions: {
        Row: {
          device_info: string | null
          id: string
          ip_address: string | null
          logged_in_at: string
          session_token: string
          user_id: string
        }
        Insert: {
          device_info?: string | null
          id?: string
          ip_address?: string | null
          logged_in_at?: string
          session_token: string
          user_id: string
        }
        Update: {
          device_info?: string | null
          id?: string
          ip_address?: string | null
          logged_in_at?: string
          session_token?: string
          user_id?: string
        }
        Relationships: []
      }
      api_circuit_state: {
        Row: {
          failure_count: number
          last_error: string | null
          next_attempt_at: string | null
          opened_at: string | null
          service: string
          state: string
          updated_at: string
        }
        Insert: {
          failure_count?: number
          last_error?: string | null
          next_attempt_at?: string | null
          opened_at?: string | null
          service: string
          state?: string
          updated_at?: string
        }
        Update: {
          failure_count?: number
          last_error?: string | null
          next_attempt_at?: string | null
          opened_at?: string | null
          service?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_usage_daily: {
        Row: {
          call_count: number
          day: string
          service: string
          updated_at: string
        }
        Insert: {
          call_count?: number
          day?: string
          service: string
          updated_at?: string
        }
        Update: {
          call_count?: number
          day?: string
          service?: string
          updated_at?: string
        }
        Relationships: []
      }
      cache_api: {
        Row: {
          cache_key: string
          dados_json: Json
          status_jogo: string
          ultima_atualizacao: string
        }
        Insert: {
          cache_key: string
          dados_json?: Json
          status_jogo?: string
          ultima_atualizacao?: string
        }
        Update: {
          cache_key?: string
          dados_json?: Json
          status_jogo?: string
          ultima_atualizacao?: string
        }
        Relationships: []
      }
      fallback_logs: {
        Row: {
          api_football_failed: boolean
          cache_hit: boolean
          confidence_score: number | null
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          match_id: string | null
          signals_generated: number
          source_used: string
        }
        Insert: {
          api_football_failed?: boolean
          cache_hit?: boolean
          confidence_score?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          match_id?: string | null
          signals_generated?: number
          source_used: string
        }
        Update: {
          api_football_failed?: boolean
          cache_hit?: boolean
          confidence_score?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          match_id?: string | null
          signals_generated?: number
          source_used?: string
        }
        Relationships: []
      }
      hybrid_entries: {
        Row: {
          away_goals: number
          corners: number
          created_at: string
          da_estimated: boolean
          dangerous_attacks: number
          entry_at: string
          exit_minute: number | null
          home_goals: number
          id: string
          league: string | null
          market: string
          match_id: string
          match_name: string
          minute: number
          possession: number
          pressure: number
          resolved_at: string | null
          result: string
          shots_on_goal: number
          tier: string
          total_shots: number
          updated_at: string
          user_id: string
        }
        Insert: {
          away_goals?: number
          corners?: number
          created_at?: string
          da_estimated?: boolean
          dangerous_attacks?: number
          entry_at?: string
          exit_minute?: number | null
          home_goals?: number
          id?: string
          league?: string | null
          market: string
          match_id: string
          match_name: string
          minute?: number
          possession?: number
          pressure?: number
          resolved_at?: string | null
          result?: string
          shots_on_goal?: number
          tier: string
          total_shots?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          away_goals?: number
          corners?: number
          created_at?: string
          da_estimated?: boolean
          dangerous_attacks?: number
          entry_at?: string
          exit_minute?: number | null
          home_goals?: number
          id?: string
          league?: string | null
          market?: string
          match_id?: string
          match_name?: string
          minute?: number
          possession?: number
          pressure?: number
          resolved_at?: string | null
          result?: string
          shots_on_goal?: number
          tier?: string
          total_shots?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      match_stats_fallback: {
        Row: {
          avg_corners: number | null
          avg_goals: number | null
          away_form: string | null
          away_team: string
          btts_pct: number | null
          clean_sheets_pct: number | null
          confidence_score: number
          created_at: string
          h2h_json: Json | null
          home_form: string | null
          home_team: string
          id: string
          kickoff_at: string | null
          league: string | null
          match_id: string
          over05_pct: number | null
          over15_pct: number | null
          over25_pct: number | null
          over35_pct: number | null
          raw_payload: Json | null
          source: string
          updated_at: string
        }
        Insert: {
          avg_corners?: number | null
          avg_goals?: number | null
          away_form?: string | null
          away_team: string
          btts_pct?: number | null
          clean_sheets_pct?: number | null
          confidence_score: number
          created_at?: string
          h2h_json?: Json | null
          home_form?: string | null
          home_team: string
          id?: string
          kickoff_at?: string | null
          league?: string | null
          match_id: string
          over05_pct?: number | null
          over15_pct?: number | null
          over25_pct?: number | null
          over35_pct?: number | null
          raw_payload?: Json | null
          source: string
          updated_at?: string
        }
        Update: {
          avg_corners?: number | null
          avg_goals?: number | null
          away_form?: string | null
          away_team?: string
          btts_pct?: number | null
          clean_sheets_pct?: number | null
          confidence_score?: number
          created_at?: string
          h2h_json?: Json | null
          home_form?: string | null
          home_team?: string
          id?: string
          kickoff_at?: string | null
          league?: string | null
          match_id?: string
          over05_pct?: number | null
          over15_pct?: number | null
          over25_pct?: number | null
          over35_pct?: number | null
          raw_payload?: Json | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_admin: boolean
          subscription_expiry_date: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          is_admin?: boolean
          subscription_expiry_date?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_admin?: boolean
          subscription_expiry_date?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          id: string
          subject: string
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          id?: string
          subject: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          bucket?: string
          count?: number
          id?: string
          subject?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      rma_shadow_logs: {
        Row: {
          acceleration: number | null
          ap_norm: number | null
          block_reason: string | null
          created_at: string
          f_norm: number | null
          id: string
          market: string
          match_id: string
          match_name: string
          match_result: string | null
          minute: number
          original_signal: string | null
          pressure: number | null
          rma_score: number
          rma_verdict: string
          sot_norm: number | null
        }
        Insert: {
          acceleration?: number | null
          ap_norm?: number | null
          block_reason?: string | null
          created_at?: string
          f_norm?: number | null
          id?: string
          market: string
          match_id: string
          match_name: string
          match_result?: string | null
          minute?: number
          original_signal?: string | null
          pressure?: number | null
          rma_score?: number
          rma_verdict: string
          sot_norm?: number | null
        }
        Update: {
          acceleration?: number | null
          ap_norm?: number | null
          block_reason?: string | null
          created_at?: string
          f_norm?: number | null
          id?: string
          market?: string
          match_id?: string
          match_name?: string
          match_result?: string | null
          minute?: number
          original_signal?: string | null
          pressure?: number | null
          rma_score?: number
          rma_verdict?: string
          sot_norm?: number | null
        }
        Relationships: []
      }
      session_conflicts: {
        Row: {
          created_at: string
          id: string
          new_device_info: string | null
          new_ip: string | null
          old_device_info: string | null
          old_ip: string | null
          seen: boolean
          user_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_device_info?: string | null
          new_ip?: string | null
          old_device_info?: string | null
          old_ip?: string | null
          seen?: boolean
          user_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          new_device_info?: string | null
          new_ip?: string | null
          old_device_info?: string | null
          old_ip?: string | null
          seen?: boolean
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      signal_suggestions: {
        Row: {
          acknowledged_at: string | null
          category: string
          created_at: string
          id: string
          message: string
          metric: string
          payload: Json
          severity: string
          status: string
          subject: string
        }
        Insert: {
          acknowledged_at?: string | null
          category: string
          created_at?: string
          id?: string
          message: string
          metric: string
          payload?: Json
          severity?: string
          status?: string
          subject: string
        }
        Update: {
          acknowledged_at?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          metric?: string
          payload?: Json
          severity?: string
          status?: string
          subject?: string
        }
        Relationships: []
      }
      signal_tracking: {
        Row: {
          avg_pressure: number | null
          behavior_class: string | null
          created_at: string
          entry_at: string
          entry_minute: number
          entry_pressure: number | null
          finalized: boolean
          finalized_at: string | null
          first_goal_minute: number | null
          goals_after: number
          last_pressure: number | null
          last_seen_at: string
          league: string | null
          market: string | null
          match_id: string
          match_name: string | null
          min_pressure: number | null
          peak_pressure: number | null
          pressure_drop_pct: number | null
          pressure_std: number | null
          result: string | null
          signal_id: string
          snapshot_count: number
          snapshots: Json
          time_to_goal_sec: number | null
          updated_at: string
        }
        Insert: {
          avg_pressure?: number | null
          behavior_class?: string | null
          created_at?: string
          entry_at?: string
          entry_minute?: number
          entry_pressure?: number | null
          finalized?: boolean
          finalized_at?: string | null
          first_goal_minute?: number | null
          goals_after?: number
          last_pressure?: number | null
          last_seen_at?: string
          league?: string | null
          market?: string | null
          match_id: string
          match_name?: string | null
          min_pressure?: number | null
          peak_pressure?: number | null
          pressure_drop_pct?: number | null
          pressure_std?: number | null
          result?: string | null
          signal_id: string
          snapshot_count?: number
          snapshots?: Json
          time_to_goal_sec?: number | null
          updated_at?: string
        }
        Update: {
          avg_pressure?: number | null
          behavior_class?: string | null
          created_at?: string
          entry_at?: string
          entry_minute?: number
          entry_pressure?: number | null
          finalized?: boolean
          finalized_at?: string | null
          first_goal_minute?: number | null
          goals_after?: number
          last_pressure?: number | null
          last_seen_at?: string
          league?: string | null
          market?: string | null
          match_id?: string
          match_name?: string | null
          min_pressure?: number | null
          peak_pressure?: number | null
          pressure_drop_pct?: number | null
          pressure_std?: number | null
          result?: string | null
          signal_id?: string
          snapshot_count?: number
          snapshots?: Json
          time_to_goal_sec?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      suggestions: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          id?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      superbet_captures: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          market_hint: string | null
          parsed_json: Json | null
          parser_version: string | null
          raw_image_url: string | null
          raw_text: string | null
          source_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          market_hint?: string | null
          parsed_json?: Json | null
          parser_version?: string | null
          raw_image_url?: string | null
          raw_text?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          market_hint?: string | null
          parsed_json?: Json | null
          parser_version?: string | null
          raw_image_url?: string | null
          raw_text?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_alert_state: {
        Row: {
          alert_key: string
          last_fired_at: string
          last_payload: Json | null
        }
        Insert: {
          alert_key: string
          last_fired_at?: string
          last_payload?: Json | null
        }
        Update: {
          alert_key?: string
          last_fired_at?: string
          last_payload?: Json | null
        }
        Relationships: []
      }
      telegram_metrics: {
        Row: {
          created_at: string
          id: string
          outbox_pending: number
          total_dead: number
          total_failed: number
          total_retried: number
          total_sent: number
          window_label: string
        }
        Insert: {
          created_at?: string
          id?: string
          outbox_pending?: number
          total_dead?: number
          total_failed?: number
          total_retried?: number
          total_sent?: number
          window_label: string
        }
        Update: {
          created_at?: string
          id?: string
          outbox_pending?: number
          total_dead?: number
          total_failed?: number
          total_retried?: number
          total_sent?: number
          window_label?: string
        }
        Relationships: []
      }
      telegram_outbox: {
        Row: {
          attempts: number
          chat_id: string
          created_at: string
          delivered_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          parse_mode: string
          signal_id: string | null
          source: string | null
          status: string
          text: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          chat_id: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          parse_mode?: string
          signal_id?: string | null
          source?: string | null
          status?: string
          text: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          chat_id?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          parse_mode?: string
          signal_id?: string | null
          source?: string | null
          status?: string
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_signals: {
        Row: {
          confidence: number
          created_at: string
          edited_message: boolean
          error_message: string | null
          expected_value: number | null
          filters_validated: string | null
          id: string
          implied_probability: number | null
          janela: string | null
          league: string | null
          market: string
          market_type: string | null
          match_id: string | null
          match_name: string
          minute: number
          model_probability: number | null
          odd: number | null
          odd_min: string | null
          poisson: string | null
          premium_score: number | null
          quality_breakdown: Json | null
          quality_score: number | null
          reason: string | null
          result: string | null
          rma_score: number | null
          rma_verdict: string | null
          roi: number | null
          score: string | null
          sensitivity: string | null
          settled_at: string | null
          status: string
          success: boolean | null
          telegram_edited: boolean
          telegram_message_id: number | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          edited_message?: boolean
          error_message?: string | null
          expected_value?: number | null
          filters_validated?: string | null
          id?: string
          implied_probability?: number | null
          janela?: string | null
          league?: string | null
          market: string
          market_type?: string | null
          match_id?: string | null
          match_name: string
          minute?: number
          model_probability?: number | null
          odd?: number | null
          odd_min?: string | null
          poisson?: string | null
          premium_score?: number | null
          quality_breakdown?: Json | null
          quality_score?: number | null
          reason?: string | null
          result?: string | null
          rma_score?: number | null
          rma_verdict?: string | null
          roi?: number | null
          score?: string | null
          sensitivity?: string | null
          settled_at?: string | null
          status?: string
          success?: boolean | null
          telegram_edited?: boolean
          telegram_message_id?: number | null
        }
        Update: {
          confidence?: number
          created_at?: string
          edited_message?: boolean
          error_message?: string | null
          expected_value?: number | null
          filters_validated?: string | null
          id?: string
          implied_probability?: number | null
          janela?: string | null
          league?: string | null
          market?: string
          market_type?: string | null
          match_id?: string | null
          match_name?: string
          minute?: number
          model_probability?: number | null
          odd?: number | null
          odd_min?: string | null
          poisson?: string | null
          premium_score?: number | null
          quality_breakdown?: Json | null
          quality_score?: number | null
          reason?: string | null
          result?: string | null
          rma_score?: number | null
          rma_verdict?: string | null
          roi?: number | null
          score?: string | null
          sensitivity?: string | null
          settled_at?: string | null
          status?: string
          success?: boolean | null
          telegram_edited?: boolean
          telegram_message_id?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_cache_lock: { Args: { _cache_key: string }; Returns: undefined }
      aggregate_telegram_metrics: { Args: { _window?: string }; Returns: Json }
      alert_should_fire: {
        Args: { _alert_key: string; _cooldown_minutes?: number }
        Returns: boolean
      }
      api_usage_increment: {
        Args: { _amount?: number; _max_per_day: number; _service: string }
        Returns: Json
      }
      cb_check: { Args: { _service: string }; Returns: Json }
      cb_record_failure: {
        Args: { _error: string; _service: string }
        Returns: Json
      }
      cb_record_success: { Args: { _service: string }; Returns: undefined }
      check_rate_limit: {
        Args: {
          _bucket: string
          _max_calls: number
          _subject: string
          _window_seconds: number
        }
        Returns: boolean
      }
      cleanup_cache_api: { Args: never; Returns: undefined }
      cleanup_live_cache: { Args: never; Returns: undefined }
      cleanup_old_dead_outbox: { Args: never; Returns: number }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      detect_context_patterns: { Args: never; Returns: number }
      detect_signal_degradation: { Args: never; Returns: number }
      get_signal_analytics: { Args: { p_days?: number }; Returns: Json }
      get_signal_context_analytics: { Args: { p_days?: number }; Returns: Json }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      mark_telegram_signal_failed: {
        Args: { _error: string; _signal_id: string }
        Returns: undefined
      }
      mark_telegram_signal_sent: {
        Args: { _message_id: number; _signal_id: string }
        Returns: undefined
      }
      normalize_market: { Args: { _m: string }; Returns: string }
      ops_health_monitor: { Args: never; Returns: Json }
      retry_telegram_outbox_message: { Args: { _id: string }; Returns: Json }
      try_claim_telegram_slot: {
        Args: {
          _confidence: number
          _filters_validated: string
          _janela: string
          _market: string
          _match_id: string
          _match_name: string
          _minute: number
          _odd_min: string
          _poisson: string
          _reason: string
          _score: string
          _sensitivity: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
