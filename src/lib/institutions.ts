import type { IconName } from '../components/Icon';
import type { MessageKey } from '../i18n';

export interface InstitutionVisual {
  icon: IconName;
  shortKey: MessageKey;
  pinBg: string;
  pinBorder: string;
  badgeClass: string;
}

const DEFAULT_VISUAL: InstitutionVisual = {
  icon: 'building',
  shortKey: 'inst.short.primaria',
  pinBg: '#0b5a86',
  pinBorder: '#0a3350',
  badgeClass: 'bg-brand-100 text-brand-900 border-brand-200',
};

export const INSTITUTION_VISUALS: Record<string, InstitutionVisual> = {
  'igi-timis': {
    icon: 'immigration',
    shortKey: 'inst.short.igi',
    pinBg: '#0b5a86',
    pinBorder: '#0a3350',
    badgeClass: 'bg-sky-100 text-sky-900 border-sky-200',
  },
  'upt-iso': {
    icon: 'graduation',
    shortKey: 'inst.short.upt',
    pinBg: '#6d28d9',
    pinBorder: '#4c1d95',
    badgeClass: 'bg-violet-100 text-violet-900 border-violet-200',
  },
  'university-office': {
    icon: 'campus',
    shortKey: 'inst.short.uni',
    pinBg: '#475569',
    pinBorder: '#334155',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
  'primaria-timisoara': {
    icon: 'building',
    shortKey: 'inst.short.primaria',
    pinBg: '#b45309',
    pinBorder: '#78350f',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  'anaf-timis': {
    icon: 'tax',
    shortKey: 'inst.short.anaf',
    pinBg: '#0f766e',
    pinBorder: '#115e59',
    badgeClass: 'bg-teal-100 text-teal-900 border-teal-200',
  },
  cnas: {
    icon: 'health',
    shortKey: 'inst.short.cnas',
    pinBg: '#be123c',
    pinBorder: '#881337',
    badgeClass: 'bg-rose-100 text-rose-900 border-rose-200',
  },
  'logs-timisoara': {
    icon: 'community',
    shortKey: 'inst.short.logs',
    pinBg: '#047857',
    pinBorder: '#064e3b',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  'uvt-dri': {
    icon: 'graduation',
    shortKey: 'inst.short.uvt',
    pinBg: '#4338ca',
    pinBorder: '#312e81',
    badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-200',
  },
  'umft-dri': {
    icon: 'medical',
    shortKey: 'inst.short.umft',
    pinBg: '#0e7490',
    pinBorder: '#164e63',
    badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-200',
  },
};

export function getInstitutionVisual(id: string): InstitutionVisual {
  return INSTITUTION_VISUALS[id] ?? DEFAULT_VISUAL;
}
