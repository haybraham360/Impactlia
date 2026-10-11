// Generated from the database schema by Supabase's type generator. Do not edit
// by hand: regenerate after every migration.

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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_results: {
        Row: {
          body: string
          content_hash: string
          context_hash: string
          created_at: string
          id: string
          input_hash: string
          model: string
          omitted: string[]
          organization_id: string
          prompt_version: string
          repository_id: string
          source_sha: string | null
          subject: string
          task: Database["public"]["Enums"]["ai_task"]
        }
        Insert: {
          body: string
          content_hash: string
          context_hash: string
          created_at?: string
          id?: string
          input_hash: string
          model: string
          omitted?: string[]
          organization_id: string
          prompt_version: string
          repository_id: string
          source_sha?: string | null
          subject: string
          task: Database["public"]["Enums"]["ai_task"]
        }
        Update: {
          body?: string
          content_hash?: string
          context_hash?: string
          created_at?: string
          id?: string
          input_hash?: string
          model?: string
          omitted?: string[]
          organization_id?: string
          prompt_version?: string
          repository_id?: string
          source_sha?: string | null
          subject?: string
          task?: Database["public"]["Enums"]["ai_task"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_results_repository_fkey"
            columns: ["repository_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repositories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      ai_runs: {
        Row: {
          cache_status: Database["public"]["Enums"]["ai_cache_status"]
          error_summary: string | null
          external_trace: boolean
          finished_at: string
          id: string
          input_hash: string
          input_tokens: number | null
          model: string
          model_called: boolean
          organization_id: string
          outcome: Database["public"]["Enums"]["ai_run_outcome"]
          output_tokens: number | null
          prompt_version: string
          repository_id: string
          started_at: string
          subject: string
          task: Database["public"]["Enums"]["ai_task"]
        }
        Insert: {
          cache_status: Database["public"]["Enums"]["ai_cache_status"]
          error_summary?: string | null
          external_trace: boolean
          finished_at: string
          id?: string
          input_hash: string
          input_tokens?: number | null
          model: string
          model_called: boolean
          organization_id: string
          outcome: Database["public"]["Enums"]["ai_run_outcome"]
          output_tokens?: number | null
          prompt_version: string
          repository_id: string
          started_at: string
          subject: string
          task: Database["public"]["Enums"]["ai_task"]
        }
        Update: {
          cache_status?: Database["public"]["Enums"]["ai_cache_status"]
          error_summary?: string | null
          external_trace?: boolean
          finished_at?: string
          id?: string
          input_hash?: string
          input_tokens?: number | null
          model?: string
          model_called?: boolean
          organization_id?: string
          outcome?: Database["public"]["Enums"]["ai_run_outcome"]
          output_tokens?: number | null
          prompt_version?: string
          repository_id?: string
          started_at?: string
          subject?: string
          task?: Database["public"]["Enums"]["ai_task"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_repository_fkey"
            columns: ["repository_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repositories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      analyses: {
        Row: {
          affected_file_count: number | null
          base_sha: string | null
          changed_file_count: number | null
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          graph_sha: string | null
          head_sha: string
          id: string
          last_completed_stage: Database["public"]["Enums"]["analysis_stage"] | null
          limitations: Json
          organization_id: string
          progressed_at: string
          pull_request_id: string
          risk_level: Database["public"]["Enums"]["risk_level"] | null
          stage: Database["public"]["Enums"]["analysis_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_status"]
        }
        Insert: {
          affected_file_count?: number | null
          base_sha?: string | null
          changed_file_count?: number | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          graph_sha?: string | null
          head_sha: string
          id?: string
          last_completed_stage?: Database["public"]["Enums"]["analysis_stage"] | null
          limitations?: Json
          organization_id: string
          progressed_at?: string
          pull_request_id: string
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          stage?: Database["public"]["Enums"]["analysis_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Update: {
          affected_file_count?: number | null
          base_sha?: string | null
          changed_file_count?: number | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          graph_sha?: string | null
          head_sha?: string
          id?: string
          last_completed_stage?: Database["public"]["Enums"]["analysis_stage"] | null
          limitations?: Json
          organization_id?: string
          progressed_at?: string
          pull_request_id?: string
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          stage?: Database["public"]["Enums"]["analysis_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Relationships: [
          {
            foreignKeyName: "analyses_pull_request_id_organization_id_fkey"
            columns: ["pull_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pull_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      analysis_dependencies: {
        Row: {
          analysis_id: string
          id: string
          kind: string
          organization_id: string
          source_file_id: string
          target_file_id: string
          type_only: boolean
        }
        Insert: {
          analysis_id: string
          id?: string
          kind: string
          organization_id: string
          source_file_id: string
          target_file_id: string
          type_only?: boolean
        }
        Update: {
          analysis_id?: string
          id?: string
          kind?: string
          organization_id?: string
          source_file_id?: string
          target_file_id?: string
          type_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analysis_dependencies_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_dependencies_source_file_id_analysis_id_organizat_fkey"
            columns: ["source_file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_dependencies_target_file_id_analysis_id_organizat_fkey"
            columns: ["target_file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
        ]
      }
      analysis_evidence: {
        Row: {
          analysis_id: string
          dependency_id: string | null
          file_id: string | null
          id: string
          organization_id: string
          recommendation_id: string | null
          risk_signal_id: string | null
        }
        Insert: {
          analysis_id: string
          dependency_id?: string | null
          file_id?: string | null
          id?: string
          organization_id: string
          recommendation_id?: string | null
          risk_signal_id?: string | null
        }
        Update: {
          analysis_id?: string
          dependency_id?: string | null
          file_id?: string | null
          id?: string
          organization_id?: string
          recommendation_id?: string | null
          risk_signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_evidence_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_evidence_dependency_id_analysis_id_organization_i_fkey"
            columns: ["dependency_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_dependencies"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_evidence_file_id_analysis_id_organization_id_fkey"
            columns: ["file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_evidence_recommendation_id_analysis_id_organizati_fkey"
            columns: ["recommendation_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_recommendations"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "analysis_evidence_risk_signal_id_analysis_id_organization__fkey"
            columns: ["risk_signal_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analysis_risk_signals"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
        ]
      }
      analysis_files: {
        Row: {
          additions: number | null
          analysis_id: string
          analysis_state: Database["public"]["Enums"]["analysis_file_state"] | null
          change_type: Database["public"]["Enums"]["file_change_type"] | null
          deletions: number | null
          dependency_path: string[] | null
          id: string
          impact_depth: number | null
          kind: Database["public"]["Enums"]["analysis_file_kind"]
          organization_id: string
          patch_available: boolean | null
          path: string
          previous_path: string | null
          route_count: number | null
          state_reason: string | null
        }
        Insert: {
          additions?: number | null
          analysis_id: string
          analysis_state?: Database["public"]["Enums"]["analysis_file_state"] | null
          change_type?: Database["public"]["Enums"]["file_change_type"] | null
          deletions?: number | null
          dependency_path?: string[] | null
          id?: string
          impact_depth?: number | null
          kind: Database["public"]["Enums"]["analysis_file_kind"]
          organization_id: string
          patch_available?: boolean | null
          path: string
          previous_path?: string | null
          route_count?: number | null
          state_reason?: string | null
        }
        Update: {
          additions?: number | null
          analysis_id?: string
          analysis_state?: Database["public"]["Enums"]["analysis_file_state"] | null
          change_type?: Database["public"]["Enums"]["file_change_type"] | null
          deletions?: number | null
          dependency_path?: string[] | null
          id?: string
          impact_depth?: number | null
          kind?: Database["public"]["Enums"]["analysis_file_kind"]
          organization_id?: string
          patch_available?: boolean | null
          path?: string
          previous_path?: string | null
          route_count?: number | null
          state_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_files_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      analysis_recommendations: {
        Row: {
          analysis_id: string
          body: string
          id: string
          organization_id: string
          origin: Database["public"]["Enums"]["finding_origin"]
          position: number
          reason: string | null
        }
        Insert: {
          analysis_id: string
          body: string
          id?: string
          organization_id: string
          origin: Database["public"]["Enums"]["finding_origin"]
          position: number
          reason?: string | null
        }
        Update: {
          analysis_id?: string
          body?: string
          id?: string
          organization_id?: string
          origin?: Database["public"]["Enums"]["finding_origin"]
          position?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_recommendations_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      analysis_risk_signals: {
        Row: {
          analysis_id: string
          detail: Json
          id: string
          level: Database["public"]["Enums"]["risk_level"]
          organization_id: string
          signal: string
        }
        Insert: {
          analysis_id: string
          detail?: Json
          id?: string
          level: Database["public"]["Enums"]["risk_level"]
          organization_id: string
          signal: string
        }
        Update: {
          analysis_id?: string
          detail?: Json
          id?: string
          level?: Database["public"]["Enums"]["risk_level"]
          organization_id?: string
          signal?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_risk_signals_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      pull_requests: {
        Row: {
          author_login: string
          base_ref: string
          created_at: string
          head_ref: string
          id: string
          number: number
          organization_id: string
          repository_id: string
          title: string
        }
        Insert: {
          author_login: string
          base_ref: string
          created_at?: string
          head_ref: string
          id?: string
          number: number
          organization_id: string
          repository_id: string
          title: string
        }
        Update: {
          author_login?: string
          base_ref?: string
          created_at?: string
          head_ref?: string
          id?: string
          number?: number
          organization_id?: string
          repository_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pull_requests_repository_id_organization_id_fkey"
            columns: ["repository_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repositories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repositories: {
        Row: {
          created_at: string
          default_branch: string
          id: string
          is_seed: boolean
          name: string
          organization_id: string
          owner: string
          provider: Database["public"]["Enums"]["source_control_provider"]
          provider_repository_id: string
        }
        Insert: {
          created_at?: string
          default_branch: string
          id?: string
          is_seed?: boolean
          name: string
          organization_id: string
          owner: string
          provider: Database["public"]["Enums"]["source_control_provider"]
          provider_repository_id: string
        }
        Update: {
          created_at?: string
          default_branch?: string
          id?: string
          is_seed?: boolean
          name?: string
          organization_id?: string
          owner?: string
          provider?: Database["public"]["Enums"]["source_control_provider"]
          provider_repository_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repositories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repository_graphs: {
        Row: {
          organization_id: string
          parser_output: Json
          repository_id: string
          run_id: string
        }
        Insert: {
          organization_id: string
          parser_output: Json
          repository_id: string
          run_id: string
        }
        Update: {
          organization_id?: string
          parser_output?: Json
          repository_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repository_graphs_repository_fkey"
            columns: ["repository_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repositories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repository_graphs_run_fkey"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repository_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repository_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          edge_count: number | null
          failure_reason: string | null
          file_count: number | null
          id: string
          last_completed_stage:
            | Database["public"]["Enums"]["repository_run_stage"]
            | null
          organization_id: string
          progressed_at: string
          repository_id: string | null
          requested_url: string
          source_sha: string | null
          stage: Database["public"]["Enums"]["repository_run_stage"]
          status: Database["public"]["Enums"]["repository_run_status"]
          unresolved_count: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          edge_count?: number | null
          failure_reason?: string | null
          file_count?: number | null
          id?: string
          last_completed_stage?:
            | Database["public"]["Enums"]["repository_run_stage"]
            | null
          organization_id: string
          progressed_at?: string
          repository_id?: string | null
          requested_url: string
          source_sha?: string | null
          stage?: Database["public"]["Enums"]["repository_run_stage"]
          status?: Database["public"]["Enums"]["repository_run_status"]
          unresolved_count?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          edge_count?: number | null
          failure_reason?: string | null
          file_count?: number | null
          id?: string
          last_completed_stage?:
            | Database["public"]["Enums"]["repository_run_stage"]
            | null
          organization_id?: string
          progressed_at?: string
          repository_id?: string | null
          requested_url?: string
          source_sha?: string | null
          stage?: Database["public"]["Enums"]["repository_run_stage"]
          status?: Database["public"]["Enums"]["repository_run_status"]
          unresolved_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "repository_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repository_runs_repository_fkey"
            columns: ["repository_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repositories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_analysis: {
        Args: { report: Json; run_id: string }
        Returns: undefined
      }
      complete_repository_run: {
        Args: { parser_output: Json; run_id: string; source_sha?: string }
        Returns: undefined
      }
      requesting_organization_id: { Args: never; Returns: string }
    }
    Enums: {
      ai_cache_status: "hit" | "miss" | "read-failed" | "write-failed"
      ai_run_outcome: "succeeded" | "input-failed" | "model-failed" | "rejected"
      ai_task: "file-explanation" | "folder-explanation" | "role-classification"
      analysis_file_kind: "changed" | "affected"
      analysis_file_state: "analysed" | "unanalysed"
      analysis_stage:
        | "validating"
        | "fetching"
        | "preparing"
        | "mapping"
        | "calculating"
        | "scoring"
        | "saving"
        | "complete"
      analysis_status: "pending" | "running" | "completed" | "failed"
      file_change_type: "added" | "modified" | "removed" | "renamed"
      finding_origin: "deterministic" | "ai"
      repository_run_stage:
        | "validating"
        | "fetching"
        | "preparing"
        | "parsing"
        | "calculating"
        | "saving"
        | "complete"
      repository_run_status: "running" | "completed" | "failed"
      risk_level: "low" | "medium" | "high"
      source_control_provider: "github"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
