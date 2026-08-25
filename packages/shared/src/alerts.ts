export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_KINDS = [
  'engine_overtemp',
  'engine_rpm_out_of_band',
  'rapid_descent',
  'low_altitude_high_speed',
  'fuel_low',
  'telemetry_gap',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface Alert {
  alert_id: string;
  aircraft_id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  detail: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  engine_overtemp: 'Engine over-temperature',
  engine_rpm_out_of_band: 'Engine RPM out of band',
  rapid_descent: 'Rapid descent',
  low_altitude_high_speed: 'Low altitude at high speed',
  fuel_low: 'Fuel remaining low',
  telemetry_gap: 'Telemetry gap',
};
