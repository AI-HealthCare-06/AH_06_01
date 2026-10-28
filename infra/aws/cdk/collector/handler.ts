import { createHandler } from './rdb.js';
export const handler = createHandler({url:process.env.SUPABASE_URL!,key:process.env.SUPABASE_PUBLISHABLE_KEY!});
