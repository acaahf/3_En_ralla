-- TABLA 1: Partidas de juego en tiempo real
CREATE TABLE IF NOT EXISTS partidas (
  id TEXT PRIMARY KEY,                       
  max_jugadores INT NOT NULL,                
  dimension INT NOT NULL,                    
  en_raya_para_ganar INT NOT NULL,           
  jugadores JSONB NOT NULL DEFAULT '[]'::jsonb, 
  turno_index INT NOT NULL DEFAULT 0,        
  tablero TEXT[] NOT NULL,                   
  estado TEXT NOT NULL DEFAULT 'esperando',  
  ganador TEXT DEFAULT NULL,                 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TABLA 2: Estadísticas y ranking global
CREATE TABLE IF NOT EXISTS jugadores_stats (
  nombre TEXT PRIMARY KEY,                   
  ganadas INT NOT NULL DEFAULT 0,            
  perdidas INT NOT NULL DEFAULT 0,           
  empatadas INT NOT NULL DEFAULT 0,          
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- REPLICACIÓN EN TIEMPO REAL
ALTER TABLE partidas REPLICA IDENTITY FULL;
ALTER TABLE jugadores_stats REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE partidas;
ALTER PUBLICATION supabase_realtime ADD TABLE jugadores_stats;

-- POLÍTICAS DE SEGURIDAD (RLS)
ALTER TABLE partidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permiso_Total_Partidas" ON partidas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permiso_Total_Stats" ON jugadores_stats FOR ALL USING (true) WITH CHECK (true);
