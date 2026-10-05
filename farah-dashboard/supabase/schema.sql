-- Enable RLS
ALTER DATABASE postgres SET "app.settings.jwt_secret" = 'your-secret-key';

-- Users table (uses Supabase auth.users)
-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT CHECK (category IN ('kids', 'work', 'home', 'errands', 'self', 'activity', 'omar')),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  date DATE,
  time TIME,
  status TEXT CHECK (status IN ('todo', 'doing', 'done', 'dropped')) DEFAULT 'todo',
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id, id)
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT CHECK (status IN ('active', 'paused', 'done')) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id, id)
);

-- Grocery items table
CREATE TABLE IF NOT EXISTS grocery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  store TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  archived BOOLEAN DEFAULT false,
  quantity TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id, id)
);

-- User metadata table
CREATE TABLE IF NOT EXISTS user_meta (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  key_times TEXT[] DEFAULT '{}',
  dress_big TEXT DEFAULT '',
  dress_baby TEXT DEFAULT '',
  stores TEXT[] DEFAULT '{Costco,Trader Joe''s,Target,Walmart,Amazon,Aldi,Other}',
  updated_at TIMESTAMP DEFAULT now()
);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_meta ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can only see their own tasks" ON tasks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks" ON tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks" ON tasks
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks" ON tasks
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can only see their own projects" ON projects
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" ON projects
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" ON projects
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can only see their own grocery items" ON grocery
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own grocery items" ON grocery
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own grocery items" ON grocery
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own grocery items" ON grocery
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can only see their own meta" ON user_meta
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own meta" ON user_meta
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meta" ON user_meta
  FOR UPDATE USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_date ON tasks(date);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_grocery_user_id ON grocery(user_id);
