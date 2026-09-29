import { route } from '../lib/http.js';
import { season } from '../lib/league.js';

export const GET = route(() => season());
