export const routineSlug = value => value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
export const routineMatches = (routines, draft, engine) => {
  const match = /^\/([\w-]*)$/.exec(draft);
  return match ? routines.filter(r => r.engines.includes(engine) && (r.name.includes(match[1].toLowerCase()) || r.title.toLowerCase().includes(match[1].toLowerCase()))) : [];
};
