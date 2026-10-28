export type Language = 'so' | 'en';

export type UserRole = 'supervisor' | 'technician';

export type TaskType = 'installation' | 'cilada';

export type TaskStatus = 'unassigned' | 'assigned' | 'in_progress' | 'blocked' | 'completed';

export type BlockerReason =
  | 'customer_unreachable'
  | 'fiber_break'
  | 'box_full'
  | 'hardware_defective'
  | 'other';

export interface Group {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface UserProfile {
  id: string;
  group_id: string;
  username: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  preferred_lang: Language;
  is_active: boolean;
  created_at?: string;
}

export interface CrewSummary {
  id: string;
  name: string;
  vehicle_tag: string | null;
  zone_focus: string | null;
}

export interface Crew extends CrewSummary {
  group_id: string;
  is_active: boolean;
  created_at?: string;
  members?: UserProfile[];
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  group: {
    id: string;
    code: string;
    name: string;
  };
  crews: CrewSummary[];
}

export interface Cablebox {
  id: string;
  group_id: string | null;
  box_code: string;
  olt_path: string | null;
  xaafada: string | null;
  total_ports: number;
  damaged_ports: number[];
  health_status: 'healthy' | 'warning' | 'critical';
  fault_count: number;
  last_optical_dbm: number | null;
  location_notes: string | null;
  updated_at: string;
}

export interface Task {
  id: string;
  group_id: string;
  import_batch_id: string | null;
  sheet_row_id: number | null;
  task_type: TaskType;
  line_number: string;
  customer_name: string;
  customer_phone: string | null;
  x_number: string | null;
  /** Qaatay / Muu interpretation of the XNumber cell (Galinta sheets) */
  router_state: 'collected' | 'not_collected' | 'unknown' | null;
  complain_type: string | null;
  dedup_key: string | null;
  disc_code: string | null;
  service_type: string;
  work_subtype: string | null;
  speed_plan: string | null;
  xaafada: string | null;
  cablebox_code_raw: string | null;
  cablebox_id: string | null;
  port_number: number | null;
  reported_date: string | null;
  reported_time: string | null;
  priority: 'normal' | 'urgent';
  carryover_count: number;
  is_repeat_fault: boolean;
  is_urgent: boolean;
  previous_task_id: string | null;
  previous_fault_summary: string | null;
  status: TaskStatus;
  assigned_user_id: string | null;
  assigned_crew_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  active_started_at: string | null;
  active_started_by: string | null;
  accumulated_seconds: number;
  blocker_reason: BlockerReason | null;
  blocker_notes: string | null;
  blocked_at: string | null;
  optical_dbm: number | null;
  completion_notes: string | null;
  completed_at: string | null;
  completed_by: string | null;
  scheduled_date: string;
  last_seen_on_sheet_date?: string | null;
  created_at: string;
  updated_at?: string;
}
