import eventLogger from '../Analytics/EventLogger';

// simulationEngine.js
// Модуль для управления симуляцией клеточного автомата

export const initializeSimulation = (
  selectedProcess, 
  simulationArea, 
  elements, 
  simulationConfig, 
  startPoint,
  isPointInPolygon
) => {
  if (!selectedProcess || !simulationArea || !startPoint) return null;
  
  const minX = Math.min(...simulationArea.points.filter((_, i) => i % 2 === 0));
  const maxX = Math.max(...simulationArea.points.filter((_, i) => i % 2 === 0));
  const minY = Math.min(...simulationArea.points.filter((_, i) => i % 2 === 1));
  const maxY = Math.max(...simulationArea.points.filter((_, i) => i % 2 === 1));
  
  const widthPixels = Math.ceil(maxX - minX);
  const heightPixels = Math.ceil(maxY - minY);
  
  const areaSize = simulationConfig.areaSize;
  let metersPerPixel = 1;
  let pixelsPerStep = 1;
  
  if (areaSize && areaSize.width && areaSize.height) {
    const avgMetersPerPixel = (areaSize.width / widthPixels + areaSize.height / heightPixels) / 2;
    metersPerPixel = avgMetersPerPixel;
    const baseSpeedMps = selectedProcess.baseSpeedMps || 0.5;
    pixelsPerStep = baseSpeedMps / metersPerPixel;
    
    console.log(`📏 Масштаб: 1 пиксель = ${metersPerPixel.toFixed(4)} м`);
    console.log(`⚡ Скорость процесса: ${baseSpeedMps} м/сек → ${pixelsPerStep.toFixed(2)} пикселей/шаг`);
  }
  
  const objectsInArea = elements.filter(el => 
    el.type === 'object' && 
    isPointInPolygon({ x: el.x, y: el.y }, simulationArea.points)
  );
  
  console.log(`Объектов в области моделирования: ${objectsInArea.length}`);
  
  const startX = Math.floor(startPoint.x - minX);
  const startY = Math.floor(startPoint.y - minY);
  
  const startPointInGrid = {
    x: startX,
    y: startY,
    originalX: startPoint.x,
    originalY: startPoint.y
  };
  
  const scaleInfo = {
    metersPerPixel,
    pixelsPerStep,
    areaWidthMeters: areaSize?.width || widthPixels,
    areaHeightMeters: areaSize?.height || heightPixels,
    gridWidth: widthPixels,
    gridHeight: heightPixels,
    minX,
    minY,
  };
  
  try {
    const initialState = selectedProcess.initialize(
      widthPixels,
      heightPixels,
      simulationConfig.environmentParams,
      objectsInArea,
      startPointInGrid,
      scaleInfo
    );

    const areaMask = createAreaMask(widthPixels, heightPixels, minX, minY, simulationArea.points, isPointInPolygon);

    return {
      ...initialState,
      width: widthPixels,
      height: heightPixels,
      minX,
      minY,
      iteration: 0,
      areaMask,
      objectsInArea,
      scaleInfo,
      affectedHistory: new Set(),
      triggeredHistory: new Set()
    };
  } catch (error) {
    console.error('Error initializing simulation:', error);
    return null;
  }
};

export const stepSimulation = (
  simulationState,
  selectedProcess,
  simulationConfig,
  elements,
  simulationArea,
  isPointInPolygon
) => {
  if (!selectedProcess || !simulationState) return null;
  
  const objectsInArea = simulationState.objectsInArea || [];
  const events = elements.filter(el => el.type === 'eventPoint');
  
  try {
    const result = selectedProcess.step(
      simulationState,
      simulationConfig.environmentParams,
      objectsInArea,
      []
    );
    
    const newState = {
      ...result.state,
      minX: simulationState.minX,
      minY: simulationState.minY,
      width: simulationState.width,
      height: simulationState.height,
      iteration: (simulationState.iteration || 0) + 1,
      areaMask: simulationState.areaMask,
      objectsInArea: simulationState.objectsInArea,
      affectedHistory: new Set(simulationState.affectedHistory || []),
      triggeredHistory: new Set(simulationState.triggeredHistory || [])
    };
    
    // 1. Обновляем историю объектов, которые попали в зону
    objectsInArea.forEach(obj => {
      const gridX = Math.floor(obj.x - simulationState.minX);
      const gridY = Math.floor(obj.y - simulationState.minY);
      
      if (gridX >= 0 && gridX < simulationState.width && 
          gridY >= 0 && gridY < simulationState.height) {
        const isInside = simulationState.areaMask?.[gridY]?.[gridX];
        const wasAffected = simulationState.affectedHistory?.has(obj.id);
        const isNowAffected = (isInside !== false && newState.grid[gridY] && newState.grid[gridY][gridX] > 0);

        if (isNowAffected) {
          // Объект в зоне - добавляем в affectedHistory
          newState.affectedHistory.add(obj.id);
        }

        // Если объект только что попал в зону (раньше не был, а сейчас стал)
        if (!wasAffected && isNowAffected) {
          console.log(`[ЗОНА] Объект "${obj.label || obj.objectType || obj.id}" попал в зону воздействия! Интенсивность: ${newState.grid[gridY][gridX]}`);
          
          eventLogger.addObjectAffected({
            objectId: obj.id,
            objectName: obj.label || obj.objectType || obj.id,
            objectType: obj.objectType,
            position: { x: obj.x, y: obj.y },
            intensity: newState.grid[gridY][gridX],
            iteration: newState.iteration,
            causeId: 'fire_spread'
          });
        }
      }
    });
    
    // Точки событий - тоже добавляем в affectedHistory
    events.forEach(event => {
      const gridX = Math.floor(event.x - simulationState.minX);
      const gridY = Math.floor(event.y - simulationState.minY);
      
      if (gridX >= 0 && gridX < simulationState.width && 
          gridY >= 0 && gridY < simulationState.height) {
        const isInside = simulationState.areaMask?.[gridY]?.[gridX];
        if (isInside !== false && newState.grid[gridY] && newState.grid[gridY][gridX] > 0) {
          newState.affectedHistory.add(event.id);
        }
      }
    });

    // 2. Проверяем активацию событий
    let updatedElements = [...elements];
    
    events.forEach(event => {
      if (event.triggerType === 'single' && event.hasTriggered) return;
      
      let shouldTrigger = false;
      let triggerReason = '';
      
      // Проверяем условие активации
      if (event.condition?.triggerOnImpact) {
        const gridX = Math.floor(event.x - simulationState.minX);
        const gridY = Math.floor(event.y - simulationState.minY);
        
        if (gridX >= 0 && gridX < simulationState.width && 
            gridY >= 0 && gridY < simulationState.height) {
          const isInside = simulationState.areaMask?.[gridY]?.[gridX];
          if (isInside !== false && newState.grid[gridY] && newState.grid[gridY][gridX] > 0) {
            shouldTrigger = true;
            triggerReason = `Попадание в зону воздействия (интенсивность: ${newState.grid[gridY][gridX]})`;
          }
        }
      }
      
      if (shouldTrigger) {
        console.log(`🎯 [СОБЫТИЕ] Активация события "${event.label || event.eventType}"! Причина: ${triggerReason}`);
        
        eventLogger.addEventTriggered({
          eventId: event.id,
          eventName: event.label || event.eventType || 'Событие',
          causeId: 'fire_impact',
          condition: 'triggerOnImpact',
          threshold: null,
          actualValue: null,
          iteration: newState.iteration,
          details: `Событие "${event.label || event.eventType}" активировано: ${triggerReason}`
        });

        newState.triggeredHistory.add(event.id);
        
        if (event.triggerType === 'single') {
          updatedElements = updatedElements.map(el => {
            if (el.id === event.id) {
              return { ...el, hasTriggered: true };
            }
            return el;
          });
        }
      }
    });
    
    // Логируем изменения объектов из процесса
    if (result.objectUpdates && result.objectUpdates.length > 0) {
      result.objectUpdates.forEach(update => {
        const obj = elements.find(e => e.id === update.objectId);
        if (obj) {
          console.log(`📝 [ИЗМЕНЕНИЕ] Объект "${obj.label || obj.objectType}": ${update.property} = ${update.newValue} (было: ${update.oldValue})`);
          
          eventLogger.objectChanged({
            objectId: update.objectId,
            objectName: obj.label || obj.objectType || update.objectId,
            objectType: obj.objectType,
            property: update.property,
            previousValue: update.oldValue,
            newValue: update.newValue,
            iteration: newState.iteration,
            causeId: 'process_step'
          });
        }
      });
    }
    
    return {
      newState,
      affectedObjects: newState.affectedHistory,
      triggeredEvents: newState.triggeredHistory,
      updatedElements,
      processEvents: result?.events || [],
    };
    
  } catch (error) {
    console.error('Error in simulation step:', error);
    return null;
  }
};

export const isSimulationComplete = (simulationState, selectedProcess, maxIterations) => {
  if (!selectedProcess || !simulationState) return false;
  
  try {
    return selectedProcess.isComplete(
      simulationState,
      maxIterations
    );
  } catch (error) {
    console.error('Error checking simulation completion:', error);
    return simulationState.iteration >= maxIterations;
  }
};

export const getCellColor = (simulationState, x, y, selectedProcess) => {
  if (!simulationState || !simulationState.grid) {
    return 'transparent';
  }

  const cellValue = simulationState.grid[y]?.[x] || 0;
  const temperature = simulationState.temperature?.[y]?.[x] || 20;
  const wetLevel = simulationState.wet?.[y]?.[x] || 0;

  try {
    return (
      selectedProcess?.getCellColor(
        cellValue,
        temperature,
        wetLevel
      ) || 'transparent'
    );
  } catch (error) {
    console.error('Error getting cell color:', error);
    return 'transparent';
  }
};

export const isObjectAffected = (obj, simulationState) => {
  if (!simulationState || !obj) return false;
  
  const gridX = Math.floor(obj.x - simulationState.minX);
  const gridY = Math.floor(obj.y - simulationState.minY);
  
  if (gridX >= 0 && gridX < simulationState.width && 
      gridY >= 0 && gridY < simulationState.height) {
    return simulationState.grid[gridY]?.[gridX] > 0;
  }
  return false;
};

export const isEventPointInZone = (eventPoint, simulationState) => {
  if (!simulationState || !eventPoint) return false;
  
  const gridX = Math.floor(eventPoint.x - simulationState.minX);
  const gridY = Math.floor(eventPoint.y - simulationState.minY);
  
  if (gridX >= 0 && gridX < simulationState.width && 
      gridY >= 0 && gridY < simulationState.height) {
    return simulationState.grid[gridY]?.[gridX] > 0;
  }
  return false;
};

export const createAreaMask = (width, height, minX, minY, polygonPoints, isPointInPolygon) => {
  const mask = Array(height).fill().map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = minX + x;
      const worldY = minY + y;
      mask[y][x] = isPointInPolygon({ x: worldX, y: worldY }, polygonPoints);
    }
  }
  
  return mask;
};

export const isAreaFullyCovered = (simulationState) => {
  if (!simulationState?.grid || !simulationState.areaMask) return false;
  return simulationState.grid.every((row, y) =>
    row.every((cell, x) => !simulationState.areaMask[y][x] || cell > 0)
  );
};

export const checkSimulationCompletion = (simulationState, selectedProcess, simulationConfig) => {
  if (!simulationState || !selectedProcess) {
    return { isComplete: false, reason: null, message: null };
  }
  
  if (isAreaFullyCovered(simulationState)) {
    return { 
      isComplete: true, 
      reason: 'full_coverage',
      message: 'Моделирование завершено! Процесс полностью заполнил область моделирования.'
    };
  }
  
  if (simulationState.iteration >= simulationConfig.maxIterations) {
    return { 
      isComplete: true, 
      reason: 'max_iterations',
      message: `Моделирование завершено по достижению максимального количества итераций (${simulationConfig.maxIterations})`
    };
  }
  
  try {
    const isProcessComplete = selectedProcess.isComplete(simulationState, simulationConfig.maxIterations);
    if (isProcessComplete) {
      return { 
        isComplete: true, 
        reason: 'process_complete',
        message: 'Моделирование завершено по условиям процесса'
      };
    }
  } catch (error) {
    console.error('Error checking process completion:', error);
  }
  
  return { isComplete: false, reason: null, message: null };
};