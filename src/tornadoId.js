const firstParam = (parameters = {}, key) => {
  const value = parameters?.[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
};

const upperText = (warning = {}) => [
  warning.event,
  warning.headline,
  warning.description,
  warning.instruction,
  warning.areaDesc
].filter(Boolean).join(' ').toUpperCase();

const rotationLabel = (score) => {
  if (score >= 85) return 'Very strong';
  if (score >= 70) return 'Strong';
  if (score >= 52) return 'Moderate';
  if (score >= 38) return 'Detected';
  return 'Low';
};

const signalLabel = (score) => {
  if (score >= 88) return 'High';
  if (score >= 70) return 'Elevated';
  if (score >= 48) return 'Possible';
  return 'Low';
};

const signalColor = (score) => {
  if (score >= 85) return '#ff2e55';
  if (score >= 70) return '#ff7043';
  if (score >= 52) return '#ffc34d';
  return '#70d7ff';
};

export const analyzeTornadoId = (warning = {}) => {
  const event = String(warning.event || '');
  const text = upperText(warning);
  const detection = firstParam(warning.parameters, 'tornadoDetection') ||
    firstParam(warning.parameters, 'tornadoTag') ||
    firstParam(warning.parameters, 'tornadoDetectionTag');
  const tornadoTag = detection.toUpperCase();
  const damageThreat = (firstParam(warning.parameters, 'tornadoDamageThreat') ||
    firstParam(warning.parameters, 'damageThreat')).toUpperCase();
  const certainty = String(warning.certainty || '').toUpperCase();
  const isTornadoWarning = /TORNADO WARNING/i.test(event);
  const isSevereWarning = /SEVERE THUNDERSTORM WARNING/i.test(event);
  const hasTornadoSignal = /POSSIBLE|RADAR INDICATED|OBSERVED|CONFIRMED/.test(tornadoTag) ||
    /VELOCITY COUPLET|GATE.TO.GATE|TIGHT ROTATION|STRONG ROTATION|TORNADIC ROTATION|TORNADO DEBRIS SIGNATURE|\bTDS\b|TORNADO ON THE GROUND|CONFIRMED TORNADO/.test(text);

  if (!isTornadoWarning && !(isSevereWarning && hasTornadoSignal)) {
    return null;
  }

  let rotation = 0;
  let tornadoSignal = 0;
  const evidence = [];

  if (isTornadoWarning) {
    rotation += 20;
    tornadoSignal += 45;
    evidence.push('Tornado warning');
  }
  if (isSevereWarning && /POSSIBLE/.test(tornadoTag)) {
    rotation += 38;
    tornadoSignal += 14;
    evidence.push('Possible tornado tag');
  }
  if (/OBSERVED|CONFIRMED/.test(tornadoTag)) {
    rotation += 75;
    tornadoSignal += 40;
    evidence.push('Observed or confirmed tag');
  } else if (/RADAR INDICATED/.test(tornadoTag)) {
    rotation += 62;
    tornadoSignal += 28;
    evidence.push('Radar indicated');
  } else if (/POSSIBLE/.test(tornadoTag)) {
    rotation += 38;
    tornadoSignal += 14;
    evidence.push('Possible tornado tag');
  }
  if (/VELOCITY COUPLET|GATE.TO.GATE|TIGHT ROTATION|STRONG ROTATION|TORNADIC ROTATION/.test(text)) {
    rotation += 28;
    tornadoSignal += 12;
    evidence.push('Rotation wording');
  } else if (/\bROTATION\b|ROTATING STORM/.test(text)) {
    rotation += 17;
    tornadoSignal += 7;
    evidence.push('Rotation mentioned');
  }
  if (/TORNADO EMERGENCY/.test(text)) {
    rotation += 15;
    tornadoSignal += 35;
    evidence.push('Tornado emergency');
  }
  if (/TORNADO DEBRIS SIGNATURE|DEBRIS SIGNATURE|\bTDS\b|DEBRIS BALL/.test(text)) {
    rotation += 18;
    tornadoSignal += 28;
    evidence.push('Debris signature');
  }
  if (/CONFIRMED TORNADO|TORNADO ON THE GROUND/.test(text)) {
    rotation += 15;
    tornadoSignal += 28;
    evidence.push('Confirmed tornado wording');
  }
  if (/FUNNEL CLOUD/.test(text)) {
    rotation += 8;
    tornadoSignal += 10;
    evidence.push('Funnel report');
  }
  if (/CATASTROPHIC/.test(damageThreat)) {
    tornadoSignal += 25;
    evidence.push('Catastrophic threat');
  } else if (/CONSIDERABLE/.test(damageThreat)) {
    tornadoSignal += 15;
    evidence.push('Considerable threat');
  }
  if (/OBSERVED/.test(certainty)) tornadoSignal += 8;
  else if (/LIKELY/.test(certainty)) tornadoSignal += 4;

  rotation = Math.min(100, rotation);
  tornadoSignal = Math.min(100, tornadoSignal);
  const peak = Math.max(rotation, tornadoSignal);

  return {
    experimental: true,
    rotation,
    rotationLabel: rotationLabel(rotation),
    tornadoSignal,
    tornadoSignalLabel: signalLabel(tornadoSignal),
    detection: tornadoTag,
    damageThreat,
    evidence: [...new Set(evidence)],
    color: signalColor(peak)
  };
};
