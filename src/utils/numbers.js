export const PickNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

export const Euro = (n) => new Intl.NumberFormat('es-ES').format(n) + ' €';