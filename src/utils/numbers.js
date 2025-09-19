const pickNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const euro = (n) => new Intl.NumberFormat('es-ES').format(n) + ' €';

module.exports = { pickNumber, euro };