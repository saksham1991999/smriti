/**
 * A small unit table for checking numerical answers entered in a different unit than the key
 * (for example 150 cm for 1.5 m). Factors are exact SI definitions, not measured constants.
 * Each unit maps to a dimension and a factor to the base unit of that dimension; temperatures also
 * carry an offset.
 */
export interface UnitInfo {
  dimension: string;
  factor: number;
  offset?: number;
}

const U = (dimension: string, factor: number, offset?: number): UnitInfo =>
  offset === undefined ? { dimension, factor } : { dimension, factor, offset };

const TABLE: Record<string, UnitInfo> = {
  // length (m)
  m: U("length", 1),
  km: U("length", 1e3),
  cm: U("length", 1e-2),
  mm: U("length", 1e-3),
  "µm": U("length", 1e-6),
  um: U("length", 1e-6),
  nm: U("length", 1e-9),
  // mass (kg)
  kg: U("mass", 1),
  g: U("mass", 1e-3),
  mg: U("mass", 1e-6),
  t: U("mass", 1e3),
  // time (s)
  s: U("time", 1),
  ms: U("time", 1e-3),
  "µs": U("time", 1e-6),
  min: U("time", 60),
  h: U("time", 3600),
  // speed (m/s)
  "m/s": U("speed", 1),
  "km/h": U("speed", 1000 / 3600),
  "cm/s": U("speed", 1e-2),
  // acceleration (m/s^2)
  "m/s^2": U("acceleration", 1),
  "m/s²": U("acceleration", 1),
  // force (N)
  N: U("force", 1),
  kN: U("force", 1e3),
  dyn: U("force", 1e-5),
  // energy (J)
  J: U("energy", 1),
  kJ: U("energy", 1e3),
  MJ: U("energy", 1e6),
  eV: U("energy", 1.602176634e-19),
  cal: U("energy", 4.184),
  kcal: U("energy", 4184),
  kWh: U("energy", 3.6e6),
  // power (W)
  W: U("power", 1),
  kW: U("power", 1e3),
  MW: U("power", 1e6),
  // pressure (Pa)
  Pa: U("pressure", 1),
  kPa: U("pressure", 1e3),
  bar: U("pressure", 1e5),
  atm: U("pressure", 101325),
  // charge (C)
  C: U("charge", 1),
  mC: U("charge", 1e-3),
  "µC": U("charge", 1e-6),
  uC: U("charge", 1e-6),
  // potential (V)
  V: U("voltage", 1),
  mV: U("voltage", 1e-3),
  kV: U("voltage", 1e3),
  // current (A)
  A: U("current", 1),
  mA: U("current", 1e-3),
  // resistance (ohm)
  "Ω": U("resistance", 1),
  ohm: U("resistance", 1),
  "kΩ": U("resistance", 1e3),
  "MΩ": U("resistance", 1e6),
  // temperature (K)
  K: U("temperature", 1),
  "°C": U("temperature", 1, 273.15),
  // amount (mol)
  mol: U("amount", 1),
  mmol: U("amount", 1e-3),
  // volume (m^3)
  "m^3": U("volume", 1),
  "m³": U("volume", 1),
  L: U("volume", 1e-3),
  mL: U("volume", 1e-6),
  "cm^3": U("volume", 1e-6),
  "cm³": U("volume", 1e-6),
  // frequency (Hz)
  Hz: U("frequency", 1),
  kHz: U("frequency", 1e3),
  MHz: U("frequency", 1e6),
  // angle (rad)
  rad: U("angle", 1),
  "°": U("angle", Math.PI / 180),
  deg: U("angle", Math.PI / 180),
  // concentration (mol/L)
  M: U("concentration", 1),
  "mol/L": U("concentration", 1),
  // ratio
  "%": U("ratio", 0.01),
  // area (m^2)
  "m^2": U("area", 1),
  "m²": U("area", 1),
  "cm^2": U("area", 1e-4),
  "cm²": U("area", 1e-4),
  "mm^2": U("area", 1e-6),
  "mm²": U("area", 1e-6),
  // electric field (V/m); N/C is the same unit
  "V/m": U("electric_field", 1),
  "N/C": U("electric_field", 1),
  "kV/m": U("electric_field", 1e3),
  "V/cm": U("electric_field", 1e2),
  // current density (A/m^2)
  "A/m^2": U("current_density", 1),
  "A/m²": U("current_density", 1),
  "A/cm^2": U("current_density", 1e4),
  "A/mm^2": U("current_density", 1e6),
  // resistivity (ohm m)
  "Ω m": U("resistivity", 1),
  "Ω·m": U("resistivity", 1),
  "ohm m": U("resistivity", 1),
  "Ω cm": U("resistivity", 1e-2),
  // conductivity (S/m)
  "S/m": U("conductivity", 1),
  "S/cm": U("conductivity", 1e2),
  // temperature coefficient (per kelvin): a temperature interval, so no offset; per °C equals per K
  "K^-1": U("per_temperature", 1),
  "K⁻¹": U("per_temperature", 1),
  "°C^-1": U("per_temperature", 1),
  "°C⁻¹": U("per_temperature", 1),
  // mobility (m^2/(V s))
  "m^2/(V s)": U("mobility", 1),
  "m²/(V s)": U("mobility", 1),
  "cm^2/(V s)": U("mobility", 1e-4),
  "cm²/(V s)": U("mobility", 1e-4),
};

export function unitInfo(unit: string): UnitInfo | undefined {
  return TABLE[unit.trim()];
}

export function isKnownUnit(unit: string): boolean {
  return unitInfo(unit) !== undefined;
}

/**
 * Convert a value between units of the same dimension. Returns undefined when either unit is
 * unknown or the dimensions differ.
 */
export function convertUnit(value: number, from: string, to: string): number | undefined {
  if (from.trim() === to.trim()) return value;
  const a = unitInfo(from);
  const b = unitInfo(to);
  if (!a || !b || a.dimension !== b.dimension) return undefined;
  const base = value * a.factor + (a.offset ?? 0);
  return (base - (b.offset ?? 0)) / b.factor;
}
