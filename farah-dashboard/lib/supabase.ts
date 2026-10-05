import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface Task {
  id: string;
  userId: string;
  title: string;
  category: "kids" | "work" | "home" | "errands" | "self" | "activity" | "omar";
  projectId: string | null;
  date: string | null;
  time: string | null;
  status: "todo" | "doing" | "done" | "dropped";
  notes: string;
  createdAt: string;
  completedAt: string | null;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  status: "active" | "paused" | "done";
  notes: string;
  createdAt: string;
}

export interface GroceryItem {
  id: string;
  userId: string;
  item: string;
  store: string;
  checked: boolean;
  archived: boolean;
  quantity: string | null;
  notes: string;
  createdAt: string;
}

export interface UserMeta {
  userId: string;
  keyTimes: string[];
  dress: { big: string; baby: string };
  stores: string[];
}
