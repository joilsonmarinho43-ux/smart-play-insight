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
      telegram_signals: {
        Row: {
          confidence: number
          created_at: string
          error_message: string | null
          filters_validated: string | null
          id: string
          janela: string | null
          market: string
          match_name: string
          minute: number
          odd_min: string | null
          poisson: string | null
          reason: string | null
          score: string | null
          sensitivity: string | null
          success: boolean
        }
        Insert: {
          confidence?: number
          created_at?: string
          error_message?: string | null
          filters_validated?: string | null
          id?: string
          janela?: string | null
          market: string
          match_name: string
          minute?: number
          odd_min?: string | null
          poisson?: string | null
          reason?: string | null
          score?: string | null
          sensitivity?: string | null
          success?: boolean
        }
        Update: {
          confidence?: number
          created_at?: string
          error_message?: string | null
          filters_validated?: string | null
          id?: string
          janela?: string | null
          market?: string
          match_name?: string
          minute?: number
          odd_min?: string | null
          poisson?: string | null
          reason?: string | null
          score?: string | null
          sensitivity?: string | null
          success?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_cache_api: { Args: never; Returns: undefined }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
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
