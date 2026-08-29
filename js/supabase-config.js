const SUPABASE_URL = 'https://aexuyhixabipmhuqvzrl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleHV5aGl4YWJpcG1odXF2enJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMTcxNTksImV4cCI6MjEwMzU5MzE1OX0.f0XkUSDI4CYKdHynY5bpsRO8nWSfuNX6gmt_bXdGJ6Y';

// Changed 'supabase' to 'supabaseClient'
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);