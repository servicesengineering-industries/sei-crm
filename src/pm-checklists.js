'use strict';
// Standard preventive maintenance check points by kind of machine or tool: [check point, method, OK when].
// Used for the demo register and the Excel template. Each machine keeps its own copy, so a
// checklist can be changed for one press without touching the others.

const CHECKLISTS = {
  press: {
    label: 'Mechanical power press',
    items: [
      ['Clutch and brake air pressure', 'Pressure gauge', '5–6 kg/cm²; ram stops within the set angle'],
      ['Flywheel, gears and crank lubrication', 'Visual, oil can', 'Oil level in range, no dry or noisy gear'],
      ['Slide gib clearance', 'Feeler gauge', '0.10–0.20 mm, no play'],
      ['Two-hand control, light curtain and emergency stop', 'Function test', 'Each one stops the press every time'],
      ['Bolster, die clamps and T-bolts', 'Spanner, visual', 'Tight, no cracks'],
      ['Central lubrication pump and lines', 'Visual', 'Pump working, oil reaching every point, no leaks'],
      ['Pneumatic lines and counterbalance', 'Soap test, gauge', 'No air leaks, counterbalance pressure as set'],
      ['Electrical panel and earthing', 'Visual', 'No loose wires or burn marks, earth connected'],
    ],
  },
  hydraulic: {
    label: 'Hydraulic press',
    items: [
      ['Hydraulic oil level and temperature', 'Sight glass, thermometer', 'Level in range, below 55 °C'],
      ['Hoses, fittings and cylinder seals', 'Visual', 'No leaks or swelling'],
      ['Working pressure', 'Pressure gauge', 'As per setting card'],
      ['Ram parallelism', 'Dial gauge', 'Within 0.10 mm'],
      ['Return-line filter', 'Indicator', 'Not clogged'],
      ['Safety guards and emergency stop', 'Function test', 'Working'],
    ],
  },
  shear: {
    label: 'Shearing machine',
    items: [
      ['Blade edges', 'Visual, trial cut', 'Sharp, no chipping, burr within limit'],
      ['Blade gap', 'Feeler gauge', 'As per sheet thickness chart'],
      ['Hold-down cylinders', 'Visual', 'All clamping, no oil leak'],
      ['Back gauge accuracy', 'Steel rule', '±0.5 mm'],
      ['Lubrication points', 'Grease gun', 'All greased'],
      ['Finger guard and foot switch', 'Function test', 'Working'],
    ],
  },
  mig: {
    label: 'MIG welding machine',
    items: [
      ['Torch liner, nozzle and contact tip', 'Visual', 'Clean, tip bore not worn oval'],
      ['Wire feed rolls and tension', 'Visual, trial run', 'Right groove size, smooth feed'],
      ['Gas flow and hose leaks', 'Flow meter, soap test', '12–15 L/min, no leaks'],
      ['Earth cable and clamp', 'Visual', 'Tight, no cuts'],
      ['Cooling fan and dust', 'Blow with dry air', 'Fan running, no dust inside'],
      ['Welding cable insulation', 'Visual', 'No cuts or burns'],
    ],
  },
  spot: {
    label: 'Spot / projection welding machine',
    items: [
      ['Electrode tips', 'Tip dresser, gauge', 'Face diameter as per standard'],
      ['Cooling water flow and temperature', 'Flow indicator', 'Flowing, outlet below 40 °C'],
      ['Air pressure on cylinder', 'Pressure gauge', 'As per weld schedule'],
      ['Secondary connections and shunts', 'Spanner, visual', 'Tight, no burning'],
      ['Weld timer settings', 'Compare with schedule', 'Match the approved weld schedule'],
      ['Weld strength check', 'Chisel / peel test', 'Nugget size OK'],
    ],
  },
  cnc: {
    label: 'CNC lathe',
    items: [
      ['Way lube oil level', 'Sight glass', 'Above minimum'],
      ['Coolant level and concentration', 'Refractometer', '5–8 %'],
      ['Chuck jaws and hydraulic pressure', 'Visual, gauge', 'Clean, pressure as set'],
      ['Axis backlash', 'Dial gauge', 'Within 0.01 mm'],
      ['Spindle noise, vibration and temperature', 'Listen, touch', 'Normal'],
      ['Electrical cabinet filter and fan', 'Visual', 'Clean, fan running'],
    ],
  },
  drill: {
    label: 'Drilling machine',
    items: [
      ['Spindle and quill lubrication', 'Oil can', 'Lubricated'],
      ['Gearbox oil level', 'Sight glass', 'In range'],
      ['Belt tension', 'Thumb press', 'About 10 mm deflection'],
      ['Arm and column clamping', 'Function test', 'Clamps firmly'],
      ['Electricals and emergency stop', 'Function test', 'Working'],
    ],
  },
  compressor: {
    label: 'Air compressor',
    items: [
      ['Drain water from tank and dryer', 'Open drain valve', 'Drained, no oil in water'],
      ['Compressor oil level', 'Sight glass', 'In range'],
      ['Air intake filter', 'Blow with dry air', 'Clean'],
      ['Belt tension and guard', 'Thumb press, visual', 'About 10 mm deflection, guard fitted'],
      ['Safety valve', 'Lift test', 'Opens and reseats'],
      ['Pressure switch cut-in and cut-out', 'Pressure gauge', 'As set, e.g. 6 / 8 kg/cm²'],
      ['Air leaks in the line', 'Listen, soap test', 'No leaks'],
    ],
  },
  coating: {
    label: 'Powder coating plant',
    items: [
      ['Oven burner or heaters', 'Function test', 'Reaches set temperature'],
      ['Oven temperature uniformity', 'Data logger', 'Within ±5 °C of set'],
      ['Conveyor chain and trolleys', 'Visual, grease', 'Lubricated, no jerks'],
      ['Booth cartridge filters', 'Pulse clean, visual', 'Clean, pressure drop normal'],
      ['Spray guns and hoses', 'Visual', 'Clean, no blockage'],
      ['Exhaust fan and ducts', 'Visual', 'Running, no build-up'],
    ],
  },
  die: {
    label: 'Press tool / die',
    items: [
      ['Punch and die cutting edges', 'Visual, burr check on last part', 'Burr below 0.1 mm; sharpen if more'],
      ['Guide pillars and bushes', 'Visual, oil', 'Lubricated, no scoring'],
      ['Springs, urethane and stripper plate', 'Visual', 'No broken springs, stripper moves freely'],
      ['Pilots and locators', 'Visual, gauge', 'Not worn or loose'],
      ['Cracks or chipping on inserts', 'Visual, magnifier', 'None'],
      ['Shut height and stroke count', 'Record', 'Shut height marked; strokes since last sharpening noted'],
    ],
  },
  fixture: {
    label: 'Welding / assembly fixture',
    items: [
      ['Locating pins', 'Pin gauge', 'Not worn below size'],
      ['Toggle clamps', 'Function test', 'Clamp firmly, no play'],
      ['Weld spatter on locators and rest pads', 'Clean, visual', 'Clean'],
      ['Poka-yoke sensors', 'Function test with wrong part', 'Wrong or missing part is stopped'],
      ['First-off part on the fixture', 'Check on checking fixture', 'OK'],
    ],
  },
  gauge: {
    label: 'Gauge / checking fixture',
    items: [
      ['Calibration due date', 'Check the tag and record', 'Not past due'],
      ['Go / no-go pins and wear', 'Measure with slip gauges', 'Within wear limit'],
      ['Damage, rust and cleanliness', 'Visual', 'None'],
      ['Identification and storage', 'Visual', 'Tag readable, stored in its place'],
      ['Master part check', 'Check the master part', 'Master passes'],
    ],
  },
};

// One check per line, as stored on each machine: "Check point: OK when (method)".
const checklistText = (kind) => CHECKLISTS[kind].items.map(([point, method, ok]) => `${point}: ${ok} (${method})`).join('\n');

module.exports = { CHECKLISTS, checklistText };
