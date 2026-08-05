// The ordered lesson registry - the single source of truth for lesson order,
// metadata, world props, reward titles, and flows.
//
// TO ADD A LESSON: create lessons/<id>.mjs (default-export an object with
//   { id, no, name, sub, icon, rewardTitle, prop:{cls|pos, html}, run(ctx) })
// then import it and add it to the array below. Nothing else changes - the core
// derives the lesson list, world props, progress dots, and reward titles from here.
import jars from './jars.mjs';
import penny from './penny.mjs';
import seeds from './seeds.mjs';
import needs from './needs.mjs';
import goal from './goal.mjs';
import earn from './earn.mjs';
import giving from './giving.mjs';
import safe from './safe.mjs';
import taxes from './taxes.mjs';

export const LESSONS = [jars, penny, seeds, needs, goal, earn, giving, safe, taxes];
