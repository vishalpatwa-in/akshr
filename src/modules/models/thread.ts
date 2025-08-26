// Thread Model
export interface Thread {
  id: string;
  object: "thread";
  created_at: number;
  metadata?: Record<string, any>;
}