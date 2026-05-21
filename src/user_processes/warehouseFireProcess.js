// warehouseFireProcess.js
// Процесс моделирования пожара на складе / в помещении
// Поддерживает: стеллажи, спринклеры, вентиляцию, двери, огнетушители (пожарные)

// Степени повреждения (по классификации М1/Т1, М2/Т2, М3/Т3)
const DAMAGE_STATUS = {
  SAFE:      'safe',       // Т1 — вне угрозы, функция сохранена
  AT_RISK:   'at_risk',    // Т1 — в зоне нагрева, функция сохранена
  DAMAGED:   'damaged',    // Т2 — временная потеря функции, восстановимо
  DESTROYED: 'destroyed',  // Т3 — необратимое разрушение
};

// Параметры спринклера по типу
const SPRINKLER_CONFIG = {
  // Расход запаса воды за шаг на одну покрытую ячейку
  flowRatePerStep: 2,
  // Эффективность подавления огня за шаг (0–1)
  suppressionRate: 1.2,
  // Намачивает объекты (стеллажи с товаром портятся)
  wetEffect: true,
};

// Параметры вентиляции по типу
const VENT_CONFIG = {
  exhaust: {
    // Вытяжка тянет воздух к себе — ускоряет горение в направлении вентиляции
    localWindBoost: 0.3,
    tempReduction: 0,
    // Без клапана передаёт огонь по воздуховоду к другим exhaust-вентиляциям
    spreadsThroughDucts: true,
  },
  supply: {
    // Приточная нагнетает воздух — создаёт избыточное давление, замедляет распространение
    localWindBoost: -0.2,
    tempReduction: 0,
    spreadsThroughDucts: false,
  },
  smoke_control: {
    // Дымоудаление — снижает температуру в зоне, замедляет горение
    localWindBoost: 0,
    tempReduction: 20, // °C за шаг
    spreadsThroughDucts: false,
  },
};

// Пожарная нагрузка по типу товара (кг/м²) — влияет на начальное топливо
const MATERIAL_FUEL = {
  flammable:     150, // ЛВЖ, аэрозоли — очень высокая нагрузка
  mixed:          80, // смешанные товары
  non_flammable:  20, // негорючие (металл, стекло и т.п.)
};

// Воспламеняемость по типу товара (базовая вероятность распространения)
const MATERIAL_FLAMMABILITY = {
  flammable:    0.85,
  mixed:        0.55,
  non_flammable: 0.15,
};

/**
 * Возвращает статус повреждения объекта по текущей температуре ячейки.
 */
function calcDamageStatus(currentTemp, thresholdT2, thresholdT3) {
  if (currentTemp >= thresholdT3) return DAMAGE_STATUS.DESTROYED;
  if (currentTemp >= thresholdT2) return DAMAGE_STATUS.DAMAGED;
  if (currentTemp > 40)           return DAMAGE_STATUS.AT_RISK;
  return DAMAGE_STATUS.SAFE;
}

/**
 * Применяет эффект спринклера: гасит огонь и снижает температуру
 * в радиусе coverageRadius от точки (cx, cy).
 * Возвращает количество потушенных ячеек.
 */
function applySprinklerEffect(newGrid, newTemp, newFuel, newWet, cx, cy, coverageRadius, suppressionRate, width, height, ambientTemp) {
  let cellsCovered = 0;
  const r = Math.ceil(coverageRadius);
  let totalEffect = 0;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > coverageRadius) continue;

      cellsCovered++;
      
      // Эффект затухает с расстоянием
      const distFactor = Math.max(0.3, 1 - dist / (coverageRadius + 0.5));
      
      // Более быстрое накопление влаги
      const wetIncrease = Math.round(15 * distFactor);
      const oldWet = newWet[ny][nx] || 0;
      newWet[ny][nx] = Math.min(100, oldWet + wetIncrease);
      
      // Более агрессивное тушение огня
      if (newGrid[ny][nx] > 0) {
        // Тушение зависит от уровня влажности
        let reduction = suppressionRate * distFactor;
        
        // Если влажность высокая - тушим быстрее
        if (newWet[ny][nx] > 50) {
          reduction *= 2;
        } else if (newWet[ny][nx] > 30) {
          reduction *= 1.5;
        }
        
        newGrid[ny][nx] = Math.max(0, newGrid[ny][nx] - reduction);
        totalEffect += reduction;
        if (newGrid[ny][nx] < 0.1) newGrid[ny][nx] = 0;
      }
      
      // Более сильное снижение температуры
      if (newWet[ny][nx] > 10) {
        const tempReduction = 15 * distFactor * (newWet[ny][nx] / 100);
        newTemp[ny][nx] = Math.max(ambientTemp || 20, newTemp[ny][nx] - tempReduction);
      }
      
      // Намокание сильно снижает воспламеняемость
      if (newWet[ny][nx] > 20 && newFuel[ny][nx] > 0) {
        newFuel[ny][nx] = Math.max(0, newFuel[ny][nx] - 5 * distFactor);
      }
    }
  }

  return { cellsCovered, totalEffect };
}

/**
 * Применяет эффект пожарных: гасит N самых интенсивных ячеек по всей сетке.
 */
function applyFirefightersEffect(newGrid, newTemp, suppressionRate, width, height) {
  // Собираем все горящие ячейки, сортируем по интенсивности (сначала самые сильные)
  const burningCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (newGrid[y][x] > 0) {
        burningCells.push({ x, y, value: newGrid[y][x] });
      }
    }
  }
  burningCells.sort((a, b) => b.value - a.value);

  // Тушим suppressionRate ячеек за шаг
  const toSuppress = Math.ceil(suppressionRate);
  for (let i = 0; i < Math.min(toSuppress, burningCells.length); i++) {
    const { x, y } = burningCells[i];
    newGrid[y][x] = Math.max(0, newGrid[y][x] - 2);
    if (newGrid[y][x] < 0.5) newGrid[y][x] = 0;
    newTemp[y][x] = Math.max(20, newTemp[y][x] - 30);
  }
}

/**
 * Находит объект в сетке по его координатам.
 */
function getGridPos(obj, minX, minY) {
  return {
    gx: Math.floor(obj.x - minX),
    gy: Math.floor(obj.y - minY),
  };
}

const warehouseFireProcess = {
  id: 'warehouse_fire',
  name: 'Пожар на складе',
  version: '1.0.0',
  baseSpeedMps: 0.3, // склад — закрытое помещение, огонь медленнее чем на открытом воздухе

  // Типы объектов

  objectTypes: [
    {
      id: 'shelf',
      name: 'Стеллаж с товарами',
      icon: '🗄️',
      defaultProperties: {
        material:        'mixed',  // тип товара: 'flammable' | 'mixed' | 'non_flammable'
        load:            70,       // загруженность стеллажа (%)
        damageThresholdT2: 80,     // °C — товар испорчен (Т2, восстановимо — страховой случай)
        damageThresholdT3: 250,    // °C — конструкция разрушена (Т3, необратимо)
        isWet:           false,    // намочен ли спринклером
        status:          DAMAGE_STATUS.SAFE,
        currentDamage:   0,        // накопленный урон (0–100%)
      },
      description: 'Стеллаж с товарами на складе. Тип товара влияет на воспламеняемость и интенсивность горения.',
    },

    {
      id: 'sprinkler',
      name: 'Система пожаротушения (спринклер)',
      icon: '🚿',
      defaultProperties: {
        activationTemp:      68,   // °C — температура срабатывания (стандарт 68°C)
        activationDelay:     10,
        coverageRadius:       100,   // радиус покрытия в ячейках сетки
        waterSupplyTotal:   500,   // общий запас (условные единицы)
        waterSupplyRemaining: 300, // текущий остаток
        isActive:          false,
        status:            DAMAGE_STATUS.SAFE,
        damageThresholdT3:  200,   // °C — система уничтожена до срабатывания
      },
      description: 'Автоматический спринклер. Срабатывает при достижении температуры активации. Имеет ограниченный запас воды.',
    },

    {
      id: 'ventilation',
      name: 'Вентиляция',
      icon: '🌬️',
      defaultProperties: {
        type:            'exhaust', // 'exhaust' | 'supply' | 'smoke_control'
        isOn:            true,
        airflowDirection: 0,        // направление потока (градусы)
        airflowSpeed:    2,         // м/с
        status:          DAMAGE_STATUS.SAFE,
        damageThresholdT2: 150,     // °C — вентиляция отключается
        damageThresholdT3: 300,     // °C — разрушена
      },
      description: 'Вентиляционная система. Тип определяет влияние на распространение огня. Exhaust — ускоряет горение, supply — замедляет, smoke_control — снижает температуру.',
    },

    {
      id: 'fire_door',
      name: 'Дверь',
      icon: '🚪',
      defaultProperties: {
        fireRating:      60,        // огнестойкость в минутах (0 — обычная дверь, 30/60/90 — противопожарная)
        isOpen:          false,     // открыта ли
        material:        'steel',   // 'wood' | 'steel' | 'glass'
        damageThresholdT2: 200,     // °C — деформация (дверь не закрывается)
        damageThresholdT3: 400,     // °C — разрушена
        status:          DAMAGE_STATUS.SAFE,
      },
      description: 'Дверь или противопожарная перегородка. Закрытая противопожарная дверь существенно замедляет распространение огня.',
    },

    {
      id: 'extinguisher',
      name: 'Огнетушитель (пожарные)',
      icon: '🧯',
      defaultProperties: {
        suppressionRate: 5,         // ячеек/шаг — интенсивность тушения пожарными
        isActive:        false,     // активирован ли (через дерево решений)
        status:          DAMAGE_STATUS.SAFE,
        damageThresholdT3: 150,     // °C — баллон повреждён до активации
      },
      description: 'Точка прибытия пожарных. После активации через дерево решений пожарные начинают тушить весь пожар, гася наиболее интенсивные очаги первыми.',
    },
  ],

  // Параметры среды

  environmentParams: [
    {
      id: 'windSpeed',
      name: 'Скорость воздушных потоков',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 5,
      unit: 'м/с',
      description: 'Скорость воздушных потоков внутри помещения (от 0 — тихо, до 5 — сильная тяга)',
    },
    {
      id: 'windDirection',
      name: 'Направление потока',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 360,
      unit: '°',
      description: 'Направление основного воздушного потока в помещении',
    },
    {
      id: 'humidity',
      name: 'Влажность воздуха',
      type: 'number',
      defaultValue: 40,
      min: 0,
      max: 100,
      unit: '%',
      description: 'Относительная влажность воздуха в помещении',
    },
    {
      id: 'temperature',
      name: 'Начальная температура',
      type: 'number',
      defaultValue: 20,
      min: -10,
      max: 40,
      unit: '°C',
      description: 'Температура воздуха в помещении до пожара',
    },
    {
      id: 'ceilingHeight',
      name: 'Высота потолка',
      type: 'number',
      defaultValue: 6,
      min: 2.5,
      max: 15,
      unit: 'м',
      description: 'Высота потолка влияет на скорость накопления тепла: чем ниже потолок — тем быстрее нагревается помещение',
    },
  ],

  // Инициализация

  initialize: (width, height, environmentParams, objects, startPoint, scaleInfo) => {
    const grid = Array(height).fill(null).map(() => Array(width).fill(0));
    const temperature = Array(height).fill(null).map(() =>
      Array(width).fill(environmentParams.temperature || 20)
    );
    const fuel = Array(height).fill(null).map(() => Array(width).fill(100));
    const wet = Array(height).fill(null).map(() => Array(width).fill(0));

    // Инициализируем топливо с учётом стеллажей
    objects.forEach(obj => {
      if (obj.type !== 'object') return;
      const gx = Math.floor(obj.x - (scaleInfo?.minX || 0));
      const gy = Math.floor(obj.y - (scaleInfo?.minY || 0));
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      if (obj.objectType === 'shelf') {
        const material = obj.properties?.material || 'mixed';
        const load = (obj.properties?.load || 70) / 100;
        const baseFuel = MATERIAL_FUEL[material] || 80;
        // Топливо = базовое * загруженность (нормировано к 0–200)
        fuel[gy][gx] = Math.min(200, baseFuel * load);
      }

      if (obj.objectType === 'fire_door') {
        // Закрытая дверь — ячейка с высоким сопротивлением (топлива нет)
        if (!obj.properties?.isOpen) {
          fuel[gy][gx] = obj.properties?.material === 'wood' ? 40 : 5;
        }
      }
    });

    // Точка начала пожара
    if (startPoint) {
      const sx = Math.floor(startPoint.x);
      const sy = Math.floor(startPoint.y);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        grid[sy][sx] = 1;
        temperature[sy][sx] = 200;
      } else {
        const cx = Math.floor(width / 2);
        const cy = Math.floor(height / 2);
        grid[cy][cx] = 1;
        temperature[cy][cx] = 200;
      }
    }

    return {
      grid,
      temperature,
      fuel,
      wet,        // уровень намокания ячейки (0–100)
      iteration: 0,
      scaleInfo,
      // Состояние объектов — копируем чтобы мутировать внутри step
      objectStates: {},
    };
  },

  // Шаг симуляции

  step: (currentState, environmentParams, objects, events) => {
    const newState = JSON.parse(JSON.stringify(currentState));
    newState.iteration = (newState.iteration || 0) + 1;

    const width  = currentState.grid[0].length;
    const height = currentState.grid.length;
    const minX   = currentState.scaleInfo?.minX || 0;
    const minY   = currentState.scaleInfo?.minY || 0;
    const pixelsPerStep = currentState.scaleInfo?.pixelsPerStep || 1;

    const newEvents = [];

    // Параметры среды
    const windSpeed   = environmentParams.windSpeed   || 1;
    const windDir     = environmentParams.windDirection || 0;
    const humidity    = environmentParams.humidity    || 40;
    const ambientTemp = environmentParams.temperature || 20;
    const ceilH       = environmentParams.ceilingHeight || 6;

    const heatAccumFactor = Math.max(0.5, 2.5 / ceilH);

    const windRad = windDir * Math.PI / 180;
    const windX   = Math.cos(windRad) * windSpeed / 10;
    const windY   = Math.sin(windRad) * windSpeed / 10;

    // Рабочие копии
    const newGrid = currentState.grid.map(row => [...row]);
    const newTemp = currentState.temperature.map(row => [...row]);
    const newFuel = currentState.fuel.map(row => [...row]);
    const newWet  = currentState.wet.map(row => [...row]);

    const spreadRadius = Math.max(1, Math.ceil(pixelsPerStep));

    // Вентиляция: локальные эффекты
    const ventEffects = {}; // { 'y_x': { windBoost, tempReduction } }
    const exhaustPositions = []; // для распространения через воздуховоды

    objects.forEach(obj => {
      if (obj.type !== 'object' || obj.objectType !== 'ventilation') return;
      const { gx, gy } = getGridPos(obj, minX, minY);
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      const props = obj.properties || {};
      if (!props.isOn) return;

      const ventType = props.type || 'exhaust';
      const cfg = VENT_CONFIG[ventType] || VENT_CONFIG.exhaust;
      const ventStatus = calcDamageStatus(
        currentState.temperature[gy]?.[gx] || ambientTemp,
        props.damageThresholdT2 || 150,
        props.damageThresholdT3 || 300
      );

      // Вентиляция повреждена — отключаем
      if (ventStatus === DAMAGE_STATUS.DAMAGED || ventStatus === DAMAGE_STATUS.DESTROYED) return;

      // Применяем эффект в радиусе 3 ячейки
      const vr = 3;
      for (let dy = -vr; dy <= vr; dy++) {
        for (let dx = -vr; dx <= vr; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const key = `${ny}_${nx}`;
          if (!ventEffects[key]) ventEffects[key] = { windBoost: 0, tempReduction: 0 };
          ventEffects[key].windBoost    += cfg.localWindBoost;
          ventEffects[key].tempReduction += cfg.tempReduction;
        }
      }

      if (cfg.spreadsThroughDucts) {
        exhaustPositions.push({ gx, gy });
      }
    });

    const doorBarriers = {}; // { 'y_x': spreadMultiplier }

    objects.forEach(obj => {
      if (obj.type !== 'object' || obj.objectType !== 'fire_door') return;
      const { gx, gy } = getGridPos(obj, minX, minY);
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      const props = obj.properties || {};
      const doorTemp = currentState.temperature[gy]?.[gx] || ambientTemp;
      const doorStatus = calcDamageStatus(doorTemp, props.damageThresholdT2 || 200, props.damageThresholdT3 || 400);

      if (doorStatus === DAMAGE_STATUS.DESTROYED) {
        doorBarriers[`${gy}_${gx}`] = 1.0; // разрушена — не мешает
        return;
      }
      if (props.isOpen) {
        doorBarriers[`${gy}_${gx}`] = 1.0; // открыта — не мешает
        return;
      }

      // Закрытая дверь: огнестойкость влияет на барьер
      const rating = props.fireRating || 0;
      const mult = Math.max(0.02, 0.7 - rating / 120);
      doorBarriers[`${gy}_${gx}`] = mult;
    });

    // Пожарные (огнетушители): авто-активация и работа
    objects.forEach(obj => {
      if (obj.type !== 'object' || obj.objectType !== 'extinguisher') return;
      const props = obj.properties || {};

      const { gx, gy } = getGridPos(obj, minX, minY);
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      const extTemp = currentState.temperature[gy]?.[gx] || ambientTemp;

      // Уничтожен до активации — ничего не делаем
      if (extTemp >= (props.damageThresholdT3 || 150)) return;

      // Авто-активация: по температуре ИЛИ когда огонь достиг ячейки/соседей
      if (!props.isActive) {
        const tempTriggered = extTemp >= (props.activationTemp || 60);

        let fireNearby = false;
        for (let dy = -1; dy <= 1 && !fireNearby; dy++) {
          for (let dx = -1; dx <= 1 && !fireNearby; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (currentState.grid[ny][nx] > 0) fireNearby = true;
          }
        }

        if (tempTriggered || fireNearby) {
          props.isActive = true;
          const reason = tempTriggered
            ? `температура ${Math.round(extTemp)}°C`
            : 'огонь достиг позиции огнетушителя';
          newEvents.push({
            type: 'extinguisher_activated',
            objectId: obj.id,
            position: { x: obj.x, y: obj.y },
            iteration: newState.iteration,
            details: `Огнетушитель (пожарные) активирован — ${reason}`,
          });
        }
      }

      if (!props.isActive) return;

      applyFirefightersEffect(newGrid, newTemp, props.suppressionRate || 5, width, height);
    });

    // Клеточный автомат: распространение огня
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (currentState.grid[y][x] <= 0) continue;

        const cellVentEffect = ventEffects[`${y}_${x}`] || { windBoost: 0, tempReduction: 0 };

        // Скорость выгорания
        const burnRate = (3 + windSpeed + cellVentEffect.windBoost) * pixelsPerStep;
        newFuel[y][x] = Math.max(0, newFuel[y][x] - burnRate);

        // Температура нарастает с учётом потолка и вентиляции
        const tempGain = 15 * pixelsPerStep * heatAccumFactor - cellVentEffect.tempReduction;
        newTemp[y][x] = Math.min(900, currentState.temperature[y][x] + tempGain);

        if (newFuel[y][x] <= 0) {
          newGrid[y][x] = 0; // выгорело
        } else {
          newGrid[y][x] = Math.min(5, currentState.grid[y][x] + 1);
        }

        // Распространение на соседей
        for (let dy = -spreadRadius; dy <= spreadRadius; dy++) {
          for (let dx = -spreadRadius; dx <= spreadRadius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > spreadRadius) continue;

            if (currentState.grid[ny][nx] > 0) continue; // уже горит

            // Намоченная ячейка не загорается
            if (currentState.wet[ny][nx] > 60) continue;

            // Базовая вероятность
            let spreadProb = 0.25 * (1 - distance / spreadRadius);

            // Ветер
            const windEffect = dx * windX + dy * windY;
            if (windEffect > 0) spreadProb += 0.15 * windEffect;

            // Вентиляция
            const neighborVent = ventEffects[`${ny}_${nx}`] || { windBoost: 0 };
            spreadProb += neighborVent.windBoost * 0.05;

            // Влажность
            spreadProb *= (1 - humidity / 200);

            // Намокание замедляет воспламенение
            const wetLevel = currentState.wet[ny][nx] || 0;
            if (wetLevel > 0) spreadProb *= Math.max(0, 1 - wetLevel / 80);

            // Барьер двери
            const barrierMult = doorBarriers[`${ny}_${nx}`] ?? 1.0;
            spreadProb *= barrierMult;

            if (Math.random() < spreadProb) {
              newGrid[ny][nx] = 1;
              newTemp[ny][nx] = ambientTemp + 120;
            }
          }
        }
      }
    }

    // Распространение через воздуховоды (exhaust без клапана)─
    if (exhaustPositions.length > 1) {
      exhaustPositions.forEach(({ gx, gy }) => {
        // Есть ли огонь рядом с этим отверстием?
        const nearFire = [-1, 0, 1].some(dy =>
          [-1, 0, 1].some(dx => {
            const nx = gx + dx; const ny = gy + dy;
            return nx >= 0 && nx < width && ny >= 0 && ny < height && currentState.grid[ny][nx] > 0;
          })
        );
        if (!nearFire) return;

        // Передаём огонь к случайному другому exhaust с вероятностью 0.12/шаг
        if (Math.random() < 0.12) {
          const targets = exhaustPositions.filter(p => p.gx !== gx || p.gy !== gy);
          if (targets.length === 0) return;
          const target = targets[Math.floor(Math.random() * targets.length)];
          newGrid[target.gy][target.gx] = 1;
          newTemp[target.gy][target.gx] = ambientTemp + 100;
          newEvents.push({
            type: 'fire_spread_through_duct',
            from: { x: gx, y: gy },
            to:   { x: target.gx, y: target.gy },
            iteration: newState.iteration,
            details: 'Огонь распространился через вентиляционный канал',
          });
        }
      });
    }

    // Спринклеры: проверка срабатывания и работа
    objects.forEach(obj => {
      if (obj.type !== 'object' || obj.objectType !== 'sprinkler') return;
      const { gx, gy } = getGridPos(obj, minX, minY);
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      const props = obj.properties || {};
      const cellTemp = newTemp[gy]?.[gx] || ambientTemp;

      // Проверяем уничтожение до срабатывания
      if (!props.isActive && cellTemp >= (props.damageThresholdT3 || 200)) {
        if (props.status !== DAMAGE_STATUS.DESTROYED) {
          newEvents.push({
            type: 'sprinkler_destroyed',
            objectId: obj.id,
            iteration: newState.iteration,
            details: 'Спринклер уничтожен до срабатывания',
          });
        }
        return;
      }

      // Срабатывание — по температуре ИЛИ по огню в радиусе покрытия
      if (!props.isActive) {
        const tempTriggered = cellTemp >= (props.activationTemp || 68);
        
        // Проверяем огонь в радиусе покрытия
        const coverageR = Math.ceil(props.coverageRadius || 3);
        let fireInRange = false;
        for (let dy = -coverageR; dy <= coverageR && !fireInRange; dy++) {
          for (let dx = -coverageR; dx <= coverageR && !fireInRange; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > coverageR) continue;
            // Используем currentState.grid для проверки огня ДО обновления
            if (currentState.grid[ny]?.[nx] > 0) {
              fireInRange = true;
            }
          }
        }

        // Не срабатываем сразу — нужна задержка в несколько шагов
        // Добавляем счетчик для постепенной активации
        if (!props.activationProgress) props.activationProgress = 0;
        
        if (tempTriggered || fireInRange) {
          props.activationProgress = Math.min(100, (props.activationProgress || 0) + 25);
          
          if (props.activationProgress >= 100 && !props.isActive) {
            props.isActive = true;
            console.log(`💧 Спринклер ${obj.id} активирован — ${tempTriggered ? `температура ${Math.round(cellTemp)}°C` : 'огонь в зоне покрытия'}`);
            newEvents.push({
              type: 'sprinkler_activated',
              objectId: obj.id,
              position: { x: obj.x, y: obj.y },
              iteration: newState.iteration,
              details: `Спринклер сработал — ${tempTriggered ? `температура ${Math.round(cellTemp)}°C` : 'огонь в зоне покрытия'}`,
            });
          }
        } else {
          props.activationProgress = Math.max(0, (props.activationProgress || 0) - 5);
        }
      }

      if (!props.isActive) return;

      // Запас воды иссяк
      if ((props.waterSupplyRemaining || 0) <= 0) {
        if (props.status !== 'depleted') {
          props.status = 'depleted';
          newEvents.push({
            type: 'sprinkler_depleted',
            objectId: obj.id,
            iteration: newState.iteration,
            details: 'Запас воды в спринклере исчерпан',
          });
        }
        return;
      }

      // Активный спринклер тушит с постепенным эффектом
      const coverageRadius = props.coverageRadius || 3;
      
      // Эффективность тушения зависит от расстояния и времени работы
      const workTime = (newState.iteration - (props.activationIteration || newState.iteration)) || 1;
      const currentSuppressionRate = Math.min(SPRINKLER_CONFIG.suppressionRate * 2, SPRINKLER_CONFIG.suppressionRate * (1 + workTime / 5));
      
      const result = applySprinklerEffect(
        newGrid, newTemp, newFuel, newWet,
        gx, gy, coverageRadius,
        currentSuppressionRate,
        width, height, ambientTemp
      );
      const cellsCovered = result.cellsCovered;

      // Расходуем запас пропорционально покрытым ячейкам
      props.waterSupplyRemaining = Math.max(
        0,
        (props.waterSupplyRemaining || 0) - SPRINKLER_CONFIG.flowRatePerStep * cellsCovered
      );
      
      if (!props.activationIteration) props.activationIteration = newState.iteration;
    });

    // Снижение намокания со временем
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (newWet[y][x] > 0) {
          newWet[y][x] = Math.max(0, newWet[y][x] - 0.5); // высыхает постепенно
        }
      }
    }

    // Состояние объектов и события
    objects.forEach(obj => {
      if (obj.type !== 'object') return;
      const { gx, gy } = getGridPos(obj, minX, minY);
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;

      const props  = obj.properties || {};
      const cellTemp = newTemp[gy]?.[gx] || ambientTemp;
      const prevStatus = props.status;

      switch (obj.objectType) {

        case 'shelf': {
          // Намокание от спринклера
          const wetLevel = newWet[gy]?.[gx] || 0;
          if (wetLevel > 30 && props.status === DAMAGE_STATUS.SAFE) {
            props.isWet = true;
            props.status = DAMAGE_STATUS.DAMAGED; // Т2 — товар намочен, испорчен
            newEvents.push({
              type: 'shelf_wet_damage',
              objectId: obj.id,
              iteration: newState.iteration,
              details: 'Стеллаж намочен спринклером — товар испорчен (Т2)',
            });
          }

          // Термическое повреждение
          const newStatus = calcDamageStatus(cellTemp, props.damageThresholdT2 || 80, props.damageThresholdT3 || 250);
          if (newStatus !== prevStatus && newStatus !== DAMAGE_STATUS.SAFE) {
            props.status = newStatus;
            // Учитываем воспламеняемость материала в интенсивности горения
            const flammability = MATERIAL_FLAMMABILITY[props.material || 'mixed'];
            props.currentDamage = Math.min(100, (props.currentDamage || 0) + flammability * 10);

            newEvents.push({
              type: newStatus === DAMAGE_STATUS.DESTROYED ? 'shelf_destroyed' : 'shelf_damaged',
              objectId: obj.id,
              objectType: 'shelf',
              position: { x: obj.x, y: obj.y },
              iteration: newState.iteration,
              details: newStatus === DAMAGE_STATUS.DESTROYED
                ? `Стеллаж разрушен (Т3), температура ${Math.round(cellTemp)}°C`
                : `Стеллаж повреждён (Т2), температура ${Math.round(cellTemp)}°C`,
            });

            // Горящий стеллаж с ЛВЖ — дополнительное событие высокой опасности
            if (newStatus === DAMAGE_STATUS.DESTROYED && props.material === 'flammable') {
              newEvents.push({
                type: 'flammable_materials_ignited',
                objectId: obj.id,
                iteration: newState.iteration,
                details: '⚠️ Воспламенение ЛВЖ! Высокий риск взрыва и резкого ускорения распространения.',
              });
              // Резкое усиление огня в ячейке
              newGrid[gy][gx] = 5;
              newTemp[gy][gx] = Math.min(900, newTemp[gy][gx] + 200);
            }
          }
          break;
        }

        case 'sprinkler': {
          // Статус уже обновляется в блоке 6
          break;
        }

        case 'ventilation': {
          const newStatus = calcDamageStatus(cellTemp, props.damageThresholdT2 || 150, props.damageThresholdT3 || 300);
          if (newStatus !== prevStatus) {
            props.status = newStatus;
            if (newStatus === DAMAGE_STATUS.DAMAGED) {
              props.isOn = false;
              newEvents.push({
                type: 'ventilation_shutdown',
                objectId: obj.id,
                iteration: newState.iteration,
                details: `Вентиляция отключилась при температуре ${Math.round(cellTemp)}°C (Т2)`,
              });
            } else if (newStatus === DAMAGE_STATUS.DESTROYED) {
              newEvents.push({
                type: 'ventilation_destroyed',
                objectId: obj.id,
                iteration: newState.iteration,
                details: `Вентиляция разрушена (Т3)`,
              });
            }
          }
          break;
        }

        case 'fire_door': {
          const newStatus = calcDamageStatus(cellTemp, props.damageThresholdT2 || 200, props.damageThresholdT3 || 400);
          if (newStatus !== prevStatus) {
            props.status = newStatus;
            if (newStatus === DAMAGE_STATUS.DAMAGED) {
              newEvents.push({
                type: 'door_deformed',
                objectId: obj.id,
                iteration: newState.iteration,
                details: `Дверь деформирована (Т2) — барьер ослаблен, температура ${Math.round(cellTemp)}°C`,
              });
            } else if (newStatus === DAMAGE_STATUS.DESTROYED) {
              newEvents.push({
                type: 'door_destroyed',
                objectId: obj.id,
                iteration: newState.iteration,
                details: `Дверь разрушена (Т3) — барьер устранён`,
              });
            }
          }
          break;
        }

        case 'extinguisher': {
          // Проверяем уничтожение до активации
          if (!props.isActive && cellTemp >= (props.damageThresholdT3 || 150)) {
            if (props.status !== DAMAGE_STATUS.DESTROYED) {
              props.status = DAMAGE_STATUS.DESTROYED;
              newEvents.push({
                type: 'extinguisher_destroyed',
                objectId: obj.id,
                iteration: newState.iteration,
                details: 'Огнетушитель уничтожен до прибытия пожарных',
              });
            }
          }
          break;
        }

        default:
          break;
      }
    });

    newState.grid        = newGrid;
    newState.temperature = newTemp;
    newState.fuel        = newFuel;
    newState.wet         = newWet;

    return {
      state: newState,
      events: newEvents,
      environmentParams: { ...environmentParams },
    };
  },

  // Условие завершения

  isComplete: (state, maxIterations) => {
    if (state.iteration >= maxIterations) return true;
    // Пожар потух — нет горящих ячеек
    const hasFire = state.grid.some(row => row.some(cell => cell > 0));
    if (!hasFire) return true;
    return false;
  },

  // Цвет ячейки

  getCellColor: (cellValue, temperature, wetLevel = 0) => {
    // Намоченная ячейка — синий, перекрывает огонь
    if (wetLevel > 30) {
      const alpha = Math.min(0.85, 0.4 + wetLevel / 80);
      return `rgba(60, 160, 255, ${alpha})`;
    }

    if (wetLevel > 5) {
      const alpha = 0.2 + wetLevel / 100;
      return `rgba(100, 180, 255, ${alpha})`;
    }

    // Горящая ячейка (если не перекрыта влагой)
    if (cellValue > 0) {
      const intensity = Math.min(1, cellValue / 5);
      const green = Math.floor(220 * (1 - intensity));
      const alpha = 0.6 + intensity * 0.3;
      return `rgba(255, ${green}, 0, ${alpha})`;
    }

    // Остаточное тепло
    if (temperature > 80) {
      return 'rgba(255, 100, 100, 0.15)';
    }
    
    return 'transparent';
  },
};

export default warehouseFireProcess;