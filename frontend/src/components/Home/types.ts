export interface MiningUnit {
  id: string;
  name: string;
  company: string;
  location: string;
  type: 'subterranea' | 'tajo_abierto' | 'mixta';
  activeSensors: number;
  status: 'optimo' | 'advertencia' | 'critico';
}

export interface SensorData {
  id: string;
  code: string;
  name: string;
  type: 'geotecnico' | 'geoespacial' | 'ambiental' | 'hidrico' | 'proceso';
  value: number | string;
  unit: string;
  status: 'normal' | 'alerta' | 'peligro';
  location: string;
  lastUpdate: string;
}

export interface GeotechnicalMetric {
  inclinometerAngle: number; // max displacement angular °
  radarSpeed: {
    taludNorte: number;
    taludSur: number;
    botaderoEste: number;
    tajoPrincipal: number;
  };
  piezometers: {
    p1: number;
    p2: number;
    p3: number;
  };
  tailingsDamLevel: number;
  airQualityPM10: number;
  geomechRisksCount: number;
  plantOEE: number;
}

export interface FlowchartBlock {
  id: string;
  title: string;
  type: 'data' | 'decision' | 'analysis' | 'condition' | 'action';
  x: number;
  y: number;
  variable?: string;
  conditionValue?: string;
  status: 'active' | 'idle' | 'warning';
}

export interface UserState {
  isLoggedIn: boolean;
  userType: 'persona' | 'empresa';
  name: string;
  dniOrRuc: string;
  company: string;
  role: string;
  facialAuthEnabled: boolean;
}

export interface VoiceCommandSample {
  id: string;
  category: string;
  speechText: string;
  parsedAction: string;
  targetModule: string;
}
