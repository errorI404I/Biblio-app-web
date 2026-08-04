CREATE TABLE public.past_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.past_rankings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.past_rankings TO anon;
GRANT ALL ON public.past_rankings TO service_role;

ALTER TABLE public.past_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view past_rankings" ON public.past_rankings FOR SELECT USING (true);
CREATE POLICY "Anyone can insert past_rankings" ON public.past_rankings FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update past_rankings" ON public.past_rankings FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete past_rankings" ON public.past_rankings FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_past_rankings_updated_at BEFORE UPDATE ON public.past_rankings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();