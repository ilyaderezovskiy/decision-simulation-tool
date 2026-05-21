// fireProcess.js - Процесс моделирования пожара

const fireProcess = {
  id: 'fire',
  name: 'Пожар',
  version: '1.0.0',

  // Базовая скорость распространения (метров в секунду)
  baseSpeedMps: 0.5,
  
  objectTypes: [
    {
      id: 'building',
      name: 'Здание',
      icon: '🏢',
      defaultProperties: {
        resistance: 70,           // Устойчивость к огню (%)
        destructionTemp: 300,      // Температура разрушения (°C)
        material: 'concrete',      // Материал
        flammability: 0.3,         // Воспламеняемость (0-1)
        burnRate: 0.1              // Скорость горения
      },
      description: 'Обычное здание'
    },
    {
      id: 'wood_object',
      name: 'Деревянный объект',
      icon: '📦',
      defaultProperties: {
        resistance: 30,
        destructionTemp: 150,
        material: 'wood',
        flammability: 0.8,
        burnRate: 0.3
      },
      description: 'Деревянный предмет'
    },
    {
      id: 'metal_object',
      name: 'Металлический объект',
      icon: '🚗',
      defaultProperties: {
        resistance: 90,
        destructionTemp: 500,
        material: 'metal',
        flammability: 0.1,
        burnRate: 0.05
      },
      description: 'Металлический предмет'
    },
    {
      id: 'forest',
      name: 'Лес',
      icon: '🌲',
      defaultProperties: {
        resistance: 40,
        destructionTemp: 200,
        material: 'wood',
        flammability: 0.9,
        burnRate: 0.4
      },
      description: 'Лесной массив'
    }
  ],
  
  environmentParams: [
    {
      id: 'windSpeed',
      name: 'Скорость ветра',
      type: 'number',
      defaultValue: 5,
      min: 0,
      max: 20,
      unit: 'м/с',
      description: 'Скорость ветра влияет на скорость распространения'
    },
    {
      id: 'windDirection',
      name: 'Направление ветра',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 360,
      unit: '°',
      description: 'Направление ветра в градусах'
    },
    {
      id: 'humidity',
      name: 'Влажность',
      type: 'number',
      defaultValue: 60,
      min: 0,
      max: 100,
      unit: '%',
      description: 'Влажность воздуха влияет на интенсивность горения'
    },
    {
      id: 'temperature',
      name: 'Температура воздуха',
      type: 'number',
      defaultValue: 25,
      min: -10,
      max: 50,
      unit: '°C',
      description: 'Температура воздуха'
    },
    {
      id: 'fuelMoisture',
      name: 'Влажность топлива',
      type: 'number',
      defaultValue: 30,
      min: 0,
      max: 100,
      unit: '%',
      description: 'Влажность горючего материала'
    }
  ],
  
  initialize: (width, height, environmentParams, objects, startPoint, scaleInfo) => {
    const grid = Array(height).fill().map(() => Array(width).fill(0));

    if (startPoint && typeof startPoint.x === 'number' && typeof startPoint.y === 'number') {
      const x = Math.floor(startPoint.x);
      const y = Math.floor(startPoint.y);

      if (y >= 0 && y < height && x >= 0 && x < width) {
        grid[y][x] = 1;
        console.log(`🔥 Пожар начат в точке сетки (${x}, ${y})`);
        if (scaleInfo) {
          console.log(`   Масштаб: 1 пиксель = ${scaleInfo.metersPerPixel?.toFixed(2) || '?'} м`);
          console.log(`   Скорость распространения: ${scaleInfo.pixelsPerStep?.toFixed(2) || '?'} пикселей/шаг`);
        }
      } else {
        console.warn(`Точка начала (${x}, ${y}) вне границ сетки ${width}x${height}`);
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        grid[centerY][centerX] = 1;
        console.log(`Пожар начат в центре (${centerX}, ${centerY})`);
      }
    } else {
      console.warn('Точка начала не передана или имеет неверный формат');
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      grid[centerY][centerX] = 1;
    }

    return {
      grid,
      temperature: Array(height).fill().map(() => Array(width).fill(environmentParams.temperature || 25)),
      fuel: Array(height).fill().map(() => Array(width).fill(100)),
      iteration: 0,
      fireIntensity: Array(height).fill().map(() => Array(width).fill(0)),
      scaleInfo  // ← сохраняем масштаб
    };
  },
  
  step: (currentState, environmentParams, objects, events) => {
    const newState = JSON.parse(JSON.stringify(currentState));
    newState.iteration = (newState.iteration || 0) + 1;
    
    const newEvents = [];
    const width = currentState.grid[0].length;
    const height = currentState.grid.length;
    
    // Получаем значение pixelsPerStep из scaleInfo (сколько пикселей проходит за шаг)
    const pixelsPerStep = currentState.scaleInfo?.pixelsPerStep || 1;
    
    // Параметры влияния
    const windSpeed = environmentParams.windSpeed || 5;
    const windDir = environmentParams.windDirection || 0;
    const humidity = environmentParams.humidity || 60;
    const temp = environmentParams.temperature || 25;
    
    // Конвертируем направление ветра в вектор
    const windRad = windDir * Math.PI / 180;
    const windX = Math.cos(windRad) * windSpeed / 10;
    const windY = Math.sin(windRad) * windSpeed / 10;
    
    // Создаем копию для вычислений
    const newGrid = Array(height).fill().map(() => Array(width).fill(0));
    const newTemp = Array(height).fill().map(() => Array(width).fill(temp));
    const newFuel = [...currentState.fuel.map(row => [...row])];
    
    // Радиус распространения (округляем вверх, минимум 1)
    const spreadRadius = Math.max(1, Math.ceil(pixelsPerStep));
    
    // Правила клеточного автомата для пожара
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (currentState.grid[y][x] > 0) {
          // Клетка горит - скорость выгорания зависит от масштаба
          const burnRate = (5 + windSpeed) * pixelsPerStep;
          newFuel[y][x] = Math.max(0, newFuel[y][x] - burnRate);
          newTemp[y][x] = Math.min(800, currentState.temperature[y][x] + 20 * pixelsPerStep);
          
          if (newFuel[y][x] <= 0) {
            newGrid[y][x] = 0; // Выгорело
          } else {
            newGrid[y][x] = Math.min(5, currentState.grid[y][x] + 1);
          }
          
          // Распространение в радиусе spreadRadius (вместо только соседних клеток)
          for (let dy = -spreadRadius; dy <= spreadRadius; dy++) {
            for (let dx = -spreadRadius; dx <= spreadRadius; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                // Пропускаем исходную клетку
                if (dx === 0 && dy === 0) continue;
                
                // Расстояние до клетки
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > spreadRadius) continue;
                
                // Вероятность распространения зависит от расстояния
                let spreadProb = 0.3 * (1 - distance / spreadRadius);
                
                // Влияние ветра (сильнее на большем расстоянии)
                const windEffect = dx * windX + dy * windY;
                if (windEffect > 0) {
                  spreadProb += 0.2 * windEffect * (1 - distance / spreadRadius);
                }
                
                // Влияние влажности
                spreadProb *= (1 - humidity / 200);
                
                // Влияние температуры
                if (currentState.temperature[ny][nx] > 100) {
                  spreadProb *= 1.5;
                }
                
                if (currentState.grid[ny][nx] === 0 && Math.random() < spreadProb) {
                  newGrid[ny][nx] = 1;
                  newTemp[ny][nx] = temp + 100;
                }
              }
            }
          }
        }
      }
    }
    
    // Проверка взаимодействия с объектами
    objects.forEach(obj => {
      if (obj.type === 'object') {
        const gridX = Math.floor(obj.x - currentState.minX);
        const gridY = Math.floor(obj.y - currentState.minY);
        
        if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
          if (newGrid[gridY][gridX] > 0) {
            // Объект в зоне пожара
            const objectType = fireProcess.objectTypes.find(t => t.id === obj.objectType);
            if (objectType) {
              const destructionTemp = objectType.defaultProperties.destructionTemp || 300;
              
              if (newTemp[gridY][gridX] > destructionTemp) {
                newEvents.push({
                  type: 'object_destroyed',
                  objectId: obj.id,
                  objectType: obj.objectType,
                  position: { x: obj.x, y: obj.y },
                  timestamp: Date.now(),
                  iteration: newState.iteration,
                  details: `Объект разрушен при температуре ${Math.round(newTemp[gridY][gridX])}°C`
                });
              } else {
                newEvents.push({
                  type: 'object_affected',
                  objectId: obj.id,
                  objectType: obj.objectType,
                  position: { x: obj.x, y: obj.y },
                  timestamp: Date.now(),
                  iteration: newState.iteration,
                  details: `Объект в зоне пожара, температура ${Math.round(newTemp[gridY][gridX])}°C`
                });
              }
            }
          }
        }
      }
    });
    
    newState.grid = newGrid;
    newState.temperature = newTemp;
    newState.fuel = newFuel;
    
    return {
      state: newState,
      events: newEvents,
      environmentParams: { ...environmentParams }
    };
  },
  
  isComplete: (state, maxIterations) => {
    // Проверка по итерациям (но это уже проверяется в основном коде)
    if (state.iteration >= maxIterations) return true;
    
    return false;
  },

  getCellColor: (cellValue, temperature) => {
    if (cellValue === 0) {
      if (temperature > 50) return '#ffcccc';
      return 'transparent';
    }
    
    // Градиент от желтого к красному в зависимости от интенсивности
    // cellValue = 1 → желтый, cellValue = 5 → темно-красный
    const intensity = Math.min(1, cellValue / 5); // 0..1
    
    // Желтый (255, 255, 0) → красный (255, 0, 0)
    const red = 255;
    const green = Math.floor(255 * (1 - intensity));
    const blue = 0;
    
    // Полупрозрачность
    const alpha = 0.7;
    
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
};

export default fireProcess;