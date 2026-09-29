import { route } from '../lib/http.js';
import { weekState } from '../lib/league.js';
import { currentWeek } from '../lib/rules.js';

export const GET = route(async (req, url) => weekState(Number(url.searchParams.get('week')) || currentWeek()));
