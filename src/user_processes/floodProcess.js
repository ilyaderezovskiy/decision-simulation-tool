// floodProcess.js - Процесс моделирования наводнения

const floodProcess = {
    id: 'flood',
    name: 'Наводнение',
    version: '1.0.0',
    
    objectTypes: [
      {
        id: 'building2',
        name: 'Здание2',
        icon: '🏢',
        defaultProperties: {
          waterResistance: 70,      // Водостойкость (%)
          maxWaterLevel: 2,          // Максимальный уровень воды (м)
          material: 'concrete',
          floodDamage: 0.3           // Урон от наводнения
        },
        description: 'Обычное здание'
      },
      {
        id: 'wood_object2',
        name: 'Деревянный объект2',
        icon: '📦',
        defaultProperties: {
          waterResistance: 30,
          maxWaterLevel: 0.5,
          material: 'wood',
          floodDamage: 0.8
        },
        description: 'Деревянный предмет'
      },
      {
        id: 'metal_object2',
        name: 'Металлический объект2',
        icon: '🚗',
        defaultProperties: {
          waterResistance: 50,
          maxWaterLevel: 1.0,
          material: 'metal',
          floodDamage: 0.6
        },
        description: 'Металлический предмет'
      }
    ],
    
    environmentParams: [
      {
        id: 'waterRiseRate',
        name: 'Скорость подъема воды',
        type: 'number',
        defaultValue: 0.1,
        min: 0,
        max: 1,
        unit: 'м/час',
        description: 'Скорость подъема уровня воды'
      },
      {
        id: 'maxWaterLevel',
        name: 'Максимальный уровень',
        type: 'number',
        defaultValue: 5,
        min: 1,
        max: 20,
        unit: 'м',
        description: 'Максимальный уровень воды'
      },
      {
        id: 'rainIntensity',
        name: 'Интенсивность осадков',
        type: 'number',
        defaultValue: 50,
        min: 0,
        max: 100,
        unit: 'мм/час',
        description: 'Интенсивность дождя'
      }
    ],
    
    initialize: (width, height, environmentParams, objects) => {
      return {
        waterLevel: Array(height).fill().map(() => Array(width).fill(0)),
        flowDirection: Array(height).fill().map(() => Array(width).fill({ x: 0, y: 0 })),
        iteration: 0,
        terrainHeight: Array(height).fill().map(() => 
          Array(width).fill().map(() => Math.random() * 10) // Высота местности
        )
      };
    },
    
    step: (currentState, environmentParams, objects, events) => {
      const newState = JSON.parse(JSON.stringify(currentState));
      newState.iteration = (newState.iteration || 0) + 1;
      
      const newEvents = [];
      const width = currentState.waterLevel[0].length;
      const height = currentState.waterLevel.length;
      
      const waterRiseRate = environmentParams.waterRiseRate || 0.1;
      const maxLevel = environmentParams.maxWaterLevel || 5;
      
      // Добавляем воду (осадки)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          newState.waterLevel[y][x] += waterRiseRate;
          
          // Ограничиваем максимальный уровень
          newState.waterLevel[y][x] = Math.min(maxLevel, newState.waterLevel[y][x]);
        }
      }
      
      // Простая симуляция потока воды (вниз по склону)
      const newWaterLevel = [...newState.waterLevel.map(row => [...row])];
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (newState.waterLevel[y][x] > 0.1) {
            // Проверяем соседние клетки
            const neighbors = [
              [-1, -1], [0, -1], [1, -1],
              [-1, 0],          [1, 0],
              [-1, 1],  [0, 1],  [1, 1]
            ];
            
            neighbors.forEach(([dx, dy]) => {
              const nx = x + dx;
              const ny = y + dy;
              
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                // Если соседняя клетка ниже, вода течет туда
                if (newState.terrainHeight[ny][nx] < newState.terrainHeight[y][x] - 0.5) {
                  const flowAmount = Math.min(0.1, newState.waterLevel[y][x]);
                  newWaterLevel[y][x] -= flowAmount;
                  newWaterLevel[ny][nx] += flowAmount;
                }
              }
            });
          }
        }
      }
      
      newState.waterLevel = newWaterLevel;
      
      // Проверка взаимодействия с объектами
      objects.forEach(obj => {
        if (obj.type === 'object') {
          const gridX = Math.floor(obj.x);
          const gridY = Math.floor(obj.y);
          
          if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
            const waterLevel = newState.waterLevel[gridY][gridX];
            
            if (waterLevel > 0.5) {
              const objectType = floodProcess.objectTypes.find(t => t.id === obj.objectType);
              if (objectType) {
                const maxWaterLevel = objectType.defaultProperties.maxWaterLevel || 1;
                
                if (waterLevel > maxWaterLevel) {
                  newEvents.push({
                    type: 'object_submerged',
                    objectId: obj.id,
                    objectType: obj.objectType,
                    position: { x: obj.x, y: obj.y },
                    timestamp: Date.now(),
                    iteration: newState.iteration,
                    details: `Объект затоплен, уровень воды ${waterLevel.toFixed(1)}м`
                  });
                } else {
                  newEvents.push({
                    type: 'object_affected',
                    objectId: obj.id,
                    objectType: obj.objectType,
                    position: { x: obj.x, y: obj.y },
                    timestamp: Date.now(),
                    iteration: newState.iteration,
                    details: `Объект в зоне наводнения, уровень воды ${waterLevel.toFixed(1)}м`
                  });
                }
              }
            }
          }
        }
      });
      
      return {
        state: newState,
        events: newEvents,
        environmentParams: { ...environmentParams }
      };
    },
    
    isComplete: (state, maxIterations) => {
      if (state.iteration >= maxIterations) return true;
      
      // Проверяем, достигнут ли максимальный уровень воды везде
      const maxLevel = 5; // Из параметров среды
      return state.waterLevel.every(row => row.every(level => level >= maxLevel));
    },
    
    getCellColor: (waterLevel) => {
      if (waterLevel === 0) return 'transparent';
      
      const blueIntensity = Math.min(255, 150 + waterLevel * 20);
      return `rgba(0, 0, ${blueIntensity}, ${Math.min(0.8, waterLevel / 10)})`;
    }
  };
  
  export default floodProcess;