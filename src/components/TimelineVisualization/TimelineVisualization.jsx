// TimelineVisualization.jsx (исправленная версия)
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './TimelineVisualization.css';

const TimelineVisualization = ({ 
  events: propEvents = [],
  currentRunIndex: propCurrentRunIndex,
  isShowingHistory: propIsShowingHistory,
  elements = [],
  allRuns = [],
  onRunSelect,
  onBackToCurrent,
  onShowReport,
  onCsvLoaded
}) => {
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, content: null });
  const [hoveredElement, setHoveredElement] = useState(null);
  const [localEvents, setLocalEvents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRunIndex, setSelectedRunIndex] = useState(-1);
  const [isUsingExternalData, setIsUsingExternalData] = useState(true);
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const fileInputRef = useRef(null);
  const actionLevelsRef = useRef([]);
  const actionPositionsRef = useRef(new Map());

  // Определение разделителя CSV
  const detectDelimiter = (firstLine) => {
    if (firstLine.includes(';')) return ';';
    if (firstLine.includes(',')) return ',';
    if (firstLine.includes('\t')) return '\t';
    return ';';
  };

  // Парсинг CSV строки с учетом кавычек и поддержкой разных разделителей
  const parseCSVLine = (line, delimiter) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    
    return result.map(field => {
      if (field.startsWith('"') && field.endsWith('"')) {
        return field.slice(1, -1);
      }
      return field;
    });
  };

  // Парсинг CSV и извлечение запусков
  const parseCSVToEvents = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return { runs: [], eventsByRun: new Map() };
    
    // Определяем разделитель по первой строке
    const delimiter = detectDelimiter(lines[0]);
    console.log('Detected delimiter:', delimiter);
    
    const headers = parseCSVLine(lines[0], delimiter);
    console.log('Headers:', headers);
    
    // Индексы колонок (с учетом разных названий)
    const getIndex = (possibleNames) => {
      for (const name of possibleNames) {
        const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    const colIndex = {
      id: getIndex(['id', 'ID']),
      run: getIndex(['run', 'Run', 'RUN']),
      iteration: getIndex(['iteration', 'Iteration', 'ITERATION']),
      activity: getIndex(['activity', 'Activity', 'ACTIVITY']),
      timestamp: getIndex(['timestamp (sec)', 'Timestamp (sec)', 'timestamp_begin', 'Timestamp']),
      duration: getIndex(['duration(sec)', 'Duration(sec)', 'duration_sec', 'Duration']),
      type: getIndex(['type', 'Type', 'TYPE']),
      causeId: getIndex(['cause id', 'Cause ID', 'cause_id']),
      resultId: getIndex(['result id', 'Result ID', 'result_id']),
      attributes: getIndex(['attributes', 'Attributes', 'ATTRIBUTES'])
    };
    
    console.log('Column indices:', colIndex);
    
    const eventsByRun = new Map();
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], delimiter);
      if (values.length < 2) continue;
      
      const runNumber = colIndex.run >= 0 ? parseInt(values[colIndex.run]) || 0 : 1;
      const timestamp = colIndex.timestamp >= 0 ? parseFloat(values[colIndex.timestamp]) || 0 : 0;
      const durationSec = colIndex.duration >= 0 && values[colIndex.duration] && values[colIndex.duration] !== '' 
        ? parseFloat(values[colIndex.duration]) 
        : null;
      
    // Парсим атрибуты
    let attributes = {};
    if (colIndex.attributes >= 0 && values[colIndex.attributes]) {
        try {
            let attrStr = values[colIndex.attributes];
            // Убираем лишние кавычки
            attrStr = attrStr.replace(/^"|"$/g, '');
            attrStr = attrStr.replace(/""/g, '"');
            
            // Пробуем как JSON
            attributes = JSON.parse(attrStr);
        } catch (e) {
            // Парсим JS объектный литерал {key: value, key2: value2}
            try {
            const rawAttr = values[colIndex.attributes].replace(/^"|"$/g, '');
            const result = {};
            
            // Регулярка для поиска пар key: value
            // Поддерживает строки в кавычках, числа, булевы значения
            const regex = /(\w+):\s*(?:"([^"]*)"|'([^']*)'|(\d+\.?\d*)|(true|false)|([^,}]+))/g;
            let match;
            
            while ((match = regex.exec(rawAttr)) !== null) {
                const key = match[1];
                const value = match[2] || match[3] || match[4] || match[5] || match[6];
                
                if (value !== undefined) {
                // Преобразуем числа
                if (match[4] && !isNaN(parseFloat(value))) {
                    result[key] = parseFloat(value);
                }
                // Преобразуем булевы
                else if (value === 'true') result[key] = true;
                else if (value === 'false') result[key] = false;
                // Оставляем строку
                else result[key] = value;
                }
            }
            
            // Дополнительный парсинг для вложенных объектов
            const nestedMatch = rawAttr.match(/(\w+):\s*{([^}]+)}/);
            if (nestedMatch) {
                const nestedKey = nestedMatch[1];
                const nestedStr = nestedMatch[2];
                const nestedObj = {};
                
                const nestedRegex = /(\w+):\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))/g;
                let nestedMatch2;
                while ((nestedMatch2 = nestedRegex.exec(nestedStr)) !== null) {
                const nKey = nestedMatch2[1];
                const nValue = nestedMatch2[2] || nestedMatch2[3] || nestedMatch2[4];
                if (nValue !== undefined) {
                    nestedObj[nKey] = !isNaN(parseFloat(nValue)) ? parseFloat(nValue) : nValue;
                }
                }
                result[nestedKey] = nestedObj;
            }
            
            attributes = Object.keys(result).length > 0 ? result : { raw: rawAttr };
            } catch (e2) {
                attributes = { raw: values[colIndex.attributes] };
            }
        }
    }
      
      const event = {
        id: colIndex.id >= 0 ? parseInt(values[colIndex.id]) || i : i,
        run_number: runNumber,
        iteration: colIndex.iteration >= 0 && values[colIndex.iteration] ? parseInt(values[colIndex.iteration]) : null,
        activity: colIndex.activity >= 0 ? values[colIndex.activity] : '',
        timestamp_begin: timestamp,
        duration_sec: durationSec,
        type: colIndex.type >= 0 ? values[colIndex.type] : 'event',
        cause_id: colIndex.causeId >= 0 ? parseInt(values[colIndex.causeId]) || null : null,
        result_id: colIndex.resultId >= 0 ? values[colIndex.resultId] || null : null,
        attributes: attributes
      };
      
      if (!eventsByRun.has(runNumber)) {
        eventsByRun.set(runNumber, []);
      }
      eventsByRun.get(runNumber).push(event);
    }
    
    // Сортируем события по времени
    for (const [run, eventsList] of eventsByRun) {
      eventsList.sort((a, b) => (a.timestamp_begin || 0) - (b.timestamp_begin || 0));
    }
    
    // Создаем информацию о запусках
    const runsInfo = Array.from(eventsByRun.keys())
      .sort((a, b) => a - b)
      .map(run => ({
        number: run,
        events: eventsByRun.get(run),
        eventCount: eventsByRun.get(run).length,
        startTime: eventsByRun.get(run)[0]?.timestamp_begin || 0,
        endTime: eventsByRun.get(run).reduce((max, e) => Math.max(max, e.timestamp_begin || 0), 0)
      }));
    
    console.log('Parsed runs:', runsInfo.map(r => ({ number: r.number, count: r.eventCount })));
    
    return { runs: runsInfo, eventsByRun };
  };

  // Загрузка CSV файла
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        const { runs: parsedRuns, eventsByRun } = parseCSVToEvents(csvText);
        
        if (parsedRuns.length === 0) {
          alert('Не удалось найти данные в CSV файле');
          return;
        }
        
        setRuns(parsedRuns);
        setLocalEvents(parsedRuns[0]?.events || []);
        setSelectedRunIndex(0);
        setIsUsingExternalData(false);

        // Передаём загруженные данные в родитель для отчёта
        if (onCsvLoaded) {
            const allRunData = [];
            parsedRuns.forEach(run => {
            const runInfo = extractRunInfoFromEvents(run.events);
            allRunData.push({
                runNumber: run.number,
                ...runInfo,
                events: run.events
            });
            });
            onCsvLoaded(allRunData);
        }
        
        console.log(`Загружено ${parsedRuns.length} запусков`);
      } catch (err) {
        console.error('Ошибка парсинга CSV:', err);
        alert('Ошибка при загрузке файла: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const extractRunInfoFromEvents = (events) => {
    let maxThreatLevel = 'Нет';
    let damagedObjects = 0;
    let destroyedObjects = 0;
    let localizationTime = null;
    let localizationSuccess = false;
    
    const threatLevels = {
        'Т1': 1, 'М1': 1, 'Х1': 1,
        'Т2': 2, 'М2': 2, 'Х2': 2,
        'Т3': 3, 'М3': 3, 'Х3': 3
    };
    
    let maxLevel = 0;
    
    events.forEach(event => {
        const activity = event.activity || '';
        const attributes = event.attributes || {};
        
        Object.keys(threatLevels).forEach(level => {
        if (activity.includes(level)) {
            if (threatLevels[level] > maxLevel) {
            maxLevel = threatLevels[level];
            maxThreatLevel = level;
            }
        }
        });
        
        if (attributes.impactCode) {
        Object.keys(threatLevels).forEach(level => {
            if (attributes.impactCode.includes(level)) {
            if (threatLevels[level] > maxLevel) {
                maxLevel = threatLevels[level];
                maxThreatLevel = level;
            }
            }
        });
        }
        
        if (event.type === 'object') {
        if (activity.includes('разрушен') || activity.includes('destroyed') || 
            (attributes.description && attributes.description.includes('необратимое'))) {
            destroyedObjects++;
        } else if (activity.includes('повреждён') || activity.includes('damaged')) {
            damagedObjects++;
        }
        }
        
        if (activity.includes('локализация') || activity.includes('ликвидация')) {
        localizationTime = event.timestamp_begin;
        if (activity.includes('успех') || activity.includes('success') || 
            (attributes.outcome === 'success')) {
            localizationSuccess = true;
        }
        }
    });
    
    const endEvent = events.find(e => e.type === 'system' && e.activity?.includes('Завершение'));
    if (endEvent?.attributes?.outcome === 'success') {
        localizationSuccess = true;
    }
    
    return {
        maxThreatLevel,
        threatLevelValue: maxLevel,
        damagedObjects,
        destroyedObjects,
        totalDamaged: damagedObjects + destroyedObjects,
        localizationTime,
        localizationSuccess,
        localizationSuccessValue: localizationSuccess ? 1 : 0
    };
    };

  // Переключение запуска
  const handleRunChange = (runNumber) => {
    const run = runs.find(r => r.number === runNumber);
    if (run) {
      setLocalEvents(run.events);
      setSelectedRunIndex(runs.findIndex(r => r.number === runNumber));
    }
  };

  useEffect(() => {
    if (!isUsingExternalData) return;
    if (!propEvents || propEvents.length === 0) return;

    // Всегда синхронизируем — без проверки длины, иначе пропускаем события
    const runsByNumber = new Map();
    propEvents.forEach(event => {
      const runNum = event.run_number || 1;
      if (!runsByNumber.has(runNum)) runsByNumber.set(runNum, []);
      runsByNumber.get(runNum).push(event);
    });

    const parsedRuns = Array.from(runsByNumber.keys())
      .sort((a, b) => a - b)
      .map(run => ({
        number: run,
        events: runsByNumber.get(run),
        eventCount: runsByNumber.get(run).length,
        startTime: runsByNumber.get(run)[0]?.timestamp_begin || 0,
        endTime: runsByNumber.get(run).reduce((max, e) => Math.max(max, e.timestamp_begin || 0), 0)
      }));

    setRuns(parsedRuns);

    // Показываем последний (текущий) запуск — он всегда последний в списке
    const lastRunIdx = parsedRuns.length - 1;
    setSelectedRunIndex(lastRunIdx);
    setLocalEvents(parsedRuns[lastRunIdx]?.events || []);
  }, [propEvents, isUsingExternalData]);

  // Использование внешних событий (из eventLogger)
  useEffect(() => {
    if (propEvents && propEvents.length > 0 && !isUsingExternalData) {
      // Если есть внешние события и мы не в режиме загруженного CSV,
      // переключаемся на внешние события
      const runsByNumber = new Map();
      propEvents.forEach(event => {
        const runNum = event.run_number || 1;
        if (!runsByNumber.has(runNum)) runsByNumber.set(runNum, []);
        runsByNumber.get(runNum).push(event);
      });
      
      const parsedRuns = Array.from(runsByNumber.keys())
        .sort((a, b) => a - b)
        .map(run => ({
          number: run,
          events: runsByNumber.get(run),
          eventCount: runsByNumber.get(run).length,
          startTime: runsByNumber.get(run)[0]?.timestamp_begin || 0,
          endTime: runsByNumber.get(run).reduce((max, e) => Math.max(max, e.timestamp_begin || 0), 0)
        }));
      
      if (parsedRuns.length > 0) {
        setRuns(parsedRuns);
        if (propCurrentRunIndex !== undefined && propCurrentRunIndex >= 0) {
          setSelectedRunIndex(propCurrentRunIndex);
          setLocalEvents(parsedRuns[propCurrentRunIndex]?.events || []);
        } else {
          setSelectedRunIndex(0);
          setLocalEvents(parsedRuns[0]?.events || []);
        }
        setIsUsingExternalData(true);
      }
    }
  }, [propEvents, propCurrentRunIndex]);

  // Обновление при изменении выбранного запуска извне
  useEffect(() => {
    if (isUsingExternalData && propCurrentRunIndex !== undefined && propCurrentRunIndex >= 0) {
      if (runs[propCurrentRunIndex]) {
        setLocalEvents(runs[propCurrentRunIndex].events);
        setSelectedRunIndex(propCurrentRunIndex);
      }
    }
  }, [propCurrentRunIndex, isUsingExternalData]);

  const events = localEvents;

  // Цвета для объектов (уникальный цвет на ID)
  const objectColors = useMemo(() => {
    const colors = {};
    const colorPalette = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8C471', '#A9DFBF', '#F9E79F', '#D7BDE2', '#AED6F1'
    ];
    let colorIndex = 0;
    
    events.forEach(event => {
      const objectId = event.attributes?.objectId;
      if (objectId && !colors[objectId]) {
        colors[objectId] = colorPalette[colorIndex % colorPalette.length];
        colorIndex++;
      }
    });
    
    return colors;
  }, [events]);

  // Получение уникальных объектов из событий
  const uniqueObjects = useMemo(() => {
    const objectsMap = new Map();
    events.forEach(event => {
      const objectId = event.attributes?.objectId;
      if (objectId && !objectsMap.has(objectId)) {
        objectsMap.set(objectId, {
          id: objectId,
          name: event.attributes?.objectName || event.attributes?.label || event.attributes?.objectLabel || objectId,
          type: event.attributes?.objectType || 'object',
          color: objectColors[objectId]
        });
      }
    });
    return Array.from(objectsMap.values());
  }, [events, objectColors]);

  // Получение списка действий (actions) из событий
  const actions = useMemo(() => {
    return events
      .filter(e => e.type === 'action')
      .map(action => ({
        id: action.id,
        name: action.activity,
        startTime: action.timestamp_begin || 0,
        duration: action.duration_sec || 0,
        endTime: (action.timestamp_begin || 0) + (action.duration_sec || 0),
        responsible: action.attributes?.responsible,
        parallel: action.attributes?.parallel,
        nodeId: action.attributes?.nodeId,
        causeId: action.cause_id,
        resultId: action.result_id
      }));
  }, [events]);

  // Определение опасного события
  const isDangerousEvent = (event) => {
    const activity = event.activity?.toLowerCase() || '';
    const dangerousKeywords = [
      'опасный', 'критический', 'разрушен', 'повреждён', 'ущерб',
      'превышает', 'необратимо', 'взрыв', 'воспламенение',
      'прерывание', 'заблокирован', 'т3', 'х3', 'м3', 'т2', 'х2', 'м2'
    ];
    return dangerousKeywords.some(keyword => activity.includes(keyword));
  };

  // Получение списка событий (events) - точки на временной шкале
  const timelineEvents = useMemo(() => {
    return events
      .filter(e => e.type === 'event' || e.type === 'object' || e.type === 'decision' || e.type === 'condition_violation' || e.type === 'system')
      .map(event => ({
        id: event.id,
        name: event.activity,
        time: event.timestamp_begin || 0,
        type: event.type,
        causeId: event.cause_id,
        attributes: event.attributes,
        iteration: event.iteration,
        isDangerous: isDangerousEvent(event)
      }));
  }, [events]);

  // Получение общего временного диапазона
  const timeRange = useMemo(() => {
    if (events.length === 0) return { min: 0, max: 100 };
    const times = events.map(e => e.timestamp_begin || 0);
    const maxTime = Math.max(...times, ...actions.map(a => a.endTime || 0));
    return { min: 0, max: Math.max(maxTime, 100) };
  }, [events, actions]);

  // Масштабирование времени в пиксели
  const timeToX = useCallback((time) => {
    const padding = 90;
    const availableWidth = dimensions.width - padding * 2;
    const ratio = availableWidth / Math.max(timeRange.max, 1);
    return padding + time * ratio;
  }, [dimensions.width, timeRange.max]);

  // Обработчики для тултипов
  const handleMouseEnter = (e, item, type, additionalData = {}) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltip({
        show: true,
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + 500,
        content: { type, ...item, ...additionalData }
      });
      setHoveredElement({ type, ...item });
    }
  };

  const handleMouseLeave = () => {
    setTooltip({ show: false, x: 0, y: 0, content: null });
    setHoveredElement(null);
  };

  // Форматирование времени
  const formatTime = (seconds) => {
    if (seconds === undefined || seconds === null) return '—';
    if (seconds < 60) return `${seconds.toFixed(1)} с`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${(seconds % 60).toFixed(0)} с`;
    return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
  };

  // Получение описания для тултипа
  const getTooltipContent = (content) => {
    switch (content.type) {
      case 'action':
        return (
          <div className="tooltip-content">
            <div className="tooltip-title">{content.name}</div>
            <div className="tooltip-row">⏱️ Длительность: {formatTime(content.duration)}</div>
            {content.responsible && <div className="tooltip-row">👤 Ответственный: {content.responsible}</div>}
            {content.parallel && <div className="tooltip-row">🔄 Параллельное выполнение</div>}
            <div className="tooltip-row">📅 Начало: {formatTime(content.startTime)}</div>
            <div className="tooltip-row">🏁 Окончание: {formatTime(content.endTime)}</div>
          </div>
        );
      case 'decision':
        return (
            <div className="tooltip-content">
            <div className="tooltip-title">Выбрано действие: {content.name}</div>
            <div className="tooltip-row">⏰ Время: {formatTime(content.time)}</div>
            {content.iteration !== undefined && <div className="tooltip-row">🔄 Итерация: {content.iteration}</div>}
            {content.attributes?.decisionNodeName && (
                <div className="tooltip-row">⚡ Decision node: {content.attributes.decisionNodeName}</div>
            )}
            {content.attributes?.selectedBranch && (
                <div className="tooltip-row">🔀 Выбрана ветка: {content.attributes.selectedBranch}</div>
            )}
            {content.attributes?.responsible && (
                <div className="tooltip-row">👤 Ответственный: {content.attributes.responsible}</div>
            )}
            {content.attributes?.description && (
                <div className="tooltip-row description">{content.attributes.description}</div>
            )}
            </div>
        );
      case 'event':
        return (
            <div className="tooltip-content">
            <div className="tooltip-title">
                {content.isDangerous ? '⚠️' : ''} {content.name}
            </div>
            <div className="tooltip-row">⏰ Время: {formatTime(content.time)}</div>
            {content.iteration !== undefined && <div className="tooltip-row">🔄 Итерация: {content.iteration}</div>}
            
            {/* Отображаем все атрибуты */}
            {content.attributes && Object.keys(content.attributes).length > 0 && (
                <div className="tooltip-attributes">
                <div className="tooltip-row attributes-title">📋 Детали:</div>
                {Object.entries(content.attributes).map(([key, value]) => {
                    // Пропускаем вложенные объекты и слишком длинные строки
                    if (typeof value === 'object') return null;
                    if (typeof value === 'string' && value.length > 100) return null;
                    return (
                    <div className="tooltip-row attribute" key={key}>
                        <span className="attribute-key">{key}:</span> {String(value)}
                    </div>
                    );
                })}
                </div>
            )}
            </div>
        );
      case 'object':
        return (
            <div className="tooltip-content">
            <div className="tooltip-title">{content.name}</div>
            <div className="tooltip-row">🏷️ ID: {content.id}</div>
            {content.type && <div className="tooltip-row">📋 Тип: {content.type}</div>}
            <div className="tooltip-row">⏰ Время: {formatTime(content.time)}</div>
            
            {/* Отображаем все атрибуты */}
            {content.attributes && Object.keys(content.attributes).length > 0 && (
                <div className="tooltip-attributes">
                <div className="tooltip-row attributes-title">📋 Детали:</div>
                {Object.entries(content.attributes).map(([key, value]) => {
                    // Пропускаем вложенные объекты
                    if (typeof value === 'object') return null;
                    // Пропускаем слишком длинные строки
                    if (typeof value === 'string' && value.length > 100) return null;
                    return (
                    <div className="tooltip-row attribute" key={key}>
                        <span className="attribute-key">{key}:</span> {String(value)}
                    </div>
                    );
                })}
                </div>
            )}
            </div>
        );
      default:
        return <div className="tooltip-content">{content.name}</div>;
    }
  };

  // Отрисовка временной шкалы
  const renderTimeline = () => {
    const ticks = [];
    const maxTime = timeRange.max;
    const tickCount = Math.min(10, Math.floor(maxTime / 10) + 1);
    const step = maxTime / tickCount;
    const timelineY = 160; // Ось смещена ниже действий
    
    for (let i = 0; i <= tickCount; i++) {
        const time = i * step;
        const x = timeToX(time);
        ticks.push(
        <g key={`tick-${i}`}>
            <line x1={x} y1={timelineY - 5} x2={x} y2={timelineY + 5} stroke="#666" strokeWidth="1" />
            <text x={x} y={timelineY + 20} textAnchor="middle" fill="#888" fontSize="10">
            {formatTime(time)}
            </text>
        </g>
        );
    }
    
    return (
        <g className="timeline-axis">
        <line x1={timeToX(0)} y1={timelineY} x2={timeToX(maxTime)} y2={timelineY} stroke="#666" strokeWidth="2" />
        {ticks}
        <text x={timeToX(maxTime)} y={timelineY - 8} textAnchor="end" fill="#888" fontSize="10">
            время →
        </text>
        </g>
    );
    };

  // Отрисовка интервальных блоков (действий)
    const renderActionBlocks = () => {
    const sortedActions = [...actions].sort((a, b) => a.startTime - b.startTime);
    const actionLevels = [];
    const trackHeight = 32;
    const startY = 40;
    
    sortedActions.forEach(action => {
        let level = 0;
        let placed = false;
        
        while (!placed) {
        const overlapping = actionLevels.some(existing => 
            existing.level === level && 
            existing.endTime > action.startTime && 
            existing.startTime < action.endTime
        );
        
        if (!overlapping) {
            actionLevels.push({ ...action, level, y: startY + level * trackHeight });
            placed = true;
        } else {
            level++;
        }
        }
    });
    
    // Сохраняем позиции для связи с событиями
    actionLevels.forEach(action => {
        actionPositionsRef.current.set(action.id, {
        startX: timeToX(action.startTime),
        endX: timeToX(action.endTime),
        y: action.y,
        height: 28
        });
    });
    
    const hoveredAction = hoveredElement?.type === 'action' 
        ? actionLevels.find(a => a.id === hoveredElement.id)
        : null;
    
    return (
        <>
        {/* Пунктирные линии при наведении */}
        {hoveredAction && (
            <>
            <line
                x1={timeToX(hoveredAction.startTime)}
                y1={hoveredAction.y + 14}
                x2={timeToX(hoveredAction.startTime)}
                y2={160}
                stroke="#888"
                strokeWidth="1.5"
                strokeDasharray="5,5"
                opacity={0.6}
            />
            <line
                x1={timeToX(hoveredAction.endTime)}
                y1={hoveredAction.y + 14}
                x2={timeToX(hoveredAction.endTime)}
                y2={160}
                stroke="#888"
                strokeWidth="1.5"
                strokeDasharray="5,5"
                opacity={0.6}
            />
            </>
        )}
        
        {actionLevels.map(action => {
            const x1 = timeToX(action.startTime);
            const x2 = timeToX(action.endTime);
            const width = Math.max(x2 - x1, 4);
            const isHovered = hoveredElement?.type === 'action' && hoveredElement?.id === action.id;
            
            // Находим связанные события ПО ID действия
            // Событие-причина: у события result_id = id действия
            const causeEvent = timelineEvents.find(e => e.resultId === action.id);
            // Событие-результат: у события cause_id = id действия  
            const resultEvent = timelineEvents.find(e => e.causeId === action.id);

            return (
            <g key={`action-${action.id}`} className="action-block-group">
                <rect
                x={x1}
                y={action.y}
                width={width}
                height={28}
                rx={4}
                fill={action.parallel ? '#38bdf8' : '#3b82f6'}
                fillOpacity={isHovered ? 0.95 : 0.75}
                stroke={isHovered ? '#fff' : 'none'}
                strokeWidth="2"
                cursor="pointer"
                onMouseEnter={(e) => handleMouseEnter(e, action, 'action')}
                onMouseLeave={handleMouseLeave}
                />
                
                {/* Событие-причина (в начале действия) */}
                {causeEvent && (
                <circle
                    cx={x1}
                    cy={action.y + 14}
                    r={6}
                    fill={causeEvent.isDangerous ? '#ef4444' : '#10b981'}
                    stroke="#fff"
                    strokeWidth="2"
                    cursor="pointer"
                    onMouseEnter={(e) => handleMouseEnter(e, causeEvent, 'event')}
                    onMouseLeave={handleMouseLeave}
                />
                )}
                
                {/* Событие-результат (в конце действия) */}
                {resultEvent && (
                <circle
                    cx={x2}
                    cy={action.y + 14}
                    r={6}
                    fill={resultEvent.isDangerous ? '#ef4444' : '#10b981'}
                    stroke="#fff"
                    strokeWidth="2"
                    cursor="pointer"
                    onMouseEnter={(e) => handleMouseEnter(e, resultEvent, 'event')}
                    onMouseLeave={handleMouseLeave}
                />
                )}
                
                {width > 60 && (
                <text
                    x={x1 + width / 2}
                    y={action.y + 18}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="10"
                    fontWeight="bold"
                >
                    {action.name.length > 20 ? action.name.slice(0, 18) + '…' : action.name}
                </text>
                )}
            </g>
            );
        })}
        </>
    );
  };

  // Отрисовка событий (точек)
  const renderEventPoints = () => {
    const timelineY = 160;
    
    // ID событий, которые уже отображены на действиях
    const attachedEventIds = new Set();
    actions.forEach(action => {
        const causeEvent = timelineEvents.find(e => e.resultId === action.id);
        const resultEvent = timelineEvents.find(e => e.causeId === action.id);
        if (causeEvent) attachedEventIds.add(causeEvent.id);
        if (resultEvent) attachedEventIds.add(resultEvent.id);
    });
    
    // События на оси (не привязанные к действиям)
    const axisEvents = timelineEvents.filter(e => 
        !attachedEventIds.has(e.id) && e.type !== 'object'
    );
    
    return axisEvents.map((event, idx) => {
        const x = timeToX(event.time);
        const isHovered = hoveredElement?.type === 'event' && hoveredElement?.id === event.id;
        let color = '#10b981';
        let size = 6;
        
        if (event.type === 'decision') {
        color = '#a855f7'; // Фиолетовый
        size = 10;
        } else if (event.type === 'condition_violation') {
        color = '#ff6b6b';
        size = 8;
        } else if (event.isDangerous) {
        color = '#ef4444';
        size = 8;
        } else if (event.type === 'system') {
        color = '#6b7280';
        size = 5;
        }
        
        return (
        <g key={`axis-event-${event.id}`} className="event-point-group">
            <line
            x1={x}
            y1={timelineY - 10}
            x2={x}
            y2={timelineY + 10}
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray="3,3"
            opacity={0.5}
            />
            <circle
            cx={x}
            cy={timelineY}
            r={size}
            fill={color}
            stroke="#fff"
            strokeWidth="2"
            cursor="pointer"
            onMouseEnter={(e) => handleMouseEnter(e, event, 'event')}
            onMouseLeave={handleMouseLeave}
            />
            {(event.isDangerous || event.type === 'condition_violation') && (
            <circle
                cx={x}
                cy={timelineY}
                r={size + 4}
                fill="none"
                stroke={color}
                strokeWidth="1"
                opacity={0.5}
                className="pulse-ring"
            />
            )}
        </g>
        );
    });
    };

  // Отрисовка слоев объектов (нижняя часть)
  const renderObjectLayers = () => {
    const layerHeight = 32;
    const startY = 200;
    const labelWidth = 80;
    
    // Группируем события по объектам
    const objectEventsMap = new Map();
    
    timelineEvents.forEach(event => {
        const objectId = event.attributes?.objectId;

        if (objectId) {
        if (!objectEventsMap.has(objectId)) {
            objectEventsMap.set(objectId, []);
        }
        objectEventsMap.get(objectId).push(event);
        }
    });
    
    // Получаем все уникальные объекты из событий
    const allObjects = Array.from(objectEventsMap.keys()).map(objectId => {
        const firstEvent = objectEventsMap.get(objectId)[0];
        return {
        id: objectId,
        name: firstEvent.attributes?.objectName || 
                firstEvent.attributes?.label || 
                firstEvent.attributes?.objectLabel || 
                objectId.slice(-8),
        color: objectColors[objectId] || '#888'
        };
    });
    
    // Подсвечиваем объекты, связанные с наведенным действием
    const hoveredAction = hoveredElement?.type === 'action' 
        ? actions.find(a => a.id === hoveredElement.id)
        : null;
    
    const highlightedObjectIds = new Set();
    if (hoveredAction) {
        // Находим объекты, связанные с этим действием
        const actionEvents = timelineEvents.filter(e => 
        e.causeId === hoveredAction.id || e.resultId === hoveredAction.id
        );
        actionEvents.forEach(event => {
        if (event.attributes?.objectId) {
            highlightedObjectIds.add(event.attributes.objectId);
        }
        });
    }
    
    return allObjects.map((obj, idx) => {
        const y = startY + idx * (layerHeight + 4);
        const eventsForObject = objectEventsMap.get(obj.id) || [];
        const isHighlighted = highlightedObjectIds.has(obj.id);
        
        return (
        <g key={`object-layer-${obj.id}`} className="object-layer">
            {/* Фоновый слой */}
            <rect
            x={timeToX(0)}
            y={y}
            width={timeToX(timeRange.max) - timeToX(0)}
            height={layerHeight}
            rx={4}
            fill={obj.color}
            fillOpacity={isHighlighted ? 0.35 : 0.12}
            stroke={obj.color}
            strokeWidth={isHighlighted ? 2 : 1}
            strokeOpacity={0.5}
            />
            
            {/* Линия жизни объекта */}
            <line
            x1={timeToX(0)}
            y1={y + layerHeight / 2}
            x2={timeToX(timeRange.max)}
            y2={y + layerHeight / 2}
            stroke={obj.color}
            strokeWidth={isHighlighted ? 2 : 1.5}
            strokeDasharray="4,4"
            opacity={0.5}
            />
            
            {/* Маркеры событий объекта */}
            {eventsForObject.map((event, eventIdx) => {
            const x = timeToX(event.time);
            const isEventHighlighted = hoveredAction && (
                event.causeId === hoveredAction.id || 
                event.resultId === hoveredAction.id
            );
            
            return (
                <g key={`obj-event-${obj.id}-${eventIdx}`}>
                <line
                    x1={x}
                    y1={y + 4}
                    x2={x}
                    y2={y + layerHeight - 4}
                    stroke={obj.color}
                    strokeWidth={isEventHighlighted ? 3 : 2}
                    opacity={0.7}
                />
                <circle
                    cx={x}
                    cy={y + layerHeight / 2}
                    r={isEventHighlighted ? 8 : 6}
                    fill={event.isDangerous ? '#ef4444' : obj.color}
                    stroke={isEventHighlighted ? '#fff' : '#fff'}
                    strokeWidth="2"
                    cursor="pointer"
                    onMouseEnter={(e) => handleMouseEnter(e, {
                    ...event,
                    name: `${obj.name}: ${event.name}`,
                    objectId: obj.id,
                    objectName: obj.name
                    }, 'event')}
                    onMouseLeave={handleMouseLeave}
                />
                </g>
            );
            })}
            
            {/* Подпись объекта слева */}
            <rect
            x={5}
            y={y}
            width={labelWidth}
            height={layerHeight}
            rx={4}
            fill={obj.color}
            fillOpacity={isHighlighted ? 0.3 : 0.15}
            stroke={obj.color}
            strokeWidth="1"
            />
            <text
            x={5 + labelWidth / 2}
            y={y + layerHeight / 2 + 4}
            textAnchor="middle"
            fill={obj.color}
            fontSize="11"
            fontWeight={isHighlighted ? 'bold' : 'normal'}
            cursor="pointer"
            onMouseEnter={(e) => handleMouseEnter(e, obj, 'object')}
            onMouseLeave={handleMouseLeave}
            >
            {obj.name.length > 18 ? obj.name.slice(0, 15) + '…' : obj.name}
            </text>
        </g>
        );
    });
    };

  // Отрисовка легенды
  const renderLegend = () => {
    return (
      <div className="timeline-legend">
        <div className="legend-title">Условные обозначения:</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-color action-color"></div>
            <span>Действие</span>
          </div>
          <div className="legend-item">
            <div className="legend-color parallel-color"></div>
            <span>Параллельное действие</span>
          </div>
          <div className="legend-item">
            <div className="legend-color event-color"></div>
            <span>Событие</span>
          </div>
          <div className="legend-item">
            <div className="legend-color dangerous-color"></div>
            <span>Опасное событие</span>
          </div>
          <div className="legend-item">
            <div className="legend-color decision-color"></div>
            <span>Выбор ветки</span>
          </div>
          <div className="legend-item">
            <div className="legend-color violation-color"></div>
            <span>Прерывание</span>
          </div>
          <div className="legend-item">
            <div className="legend-color result-indicator"></div>
            <span>Результат действия</span>
          </div>
          <div className="legend-item">
            <div className="legend-color object-layer-indicator"></div>
            <span>Состояние объекта</span>
          </div>
        </div>
      </div>
    );
  };

  // Обновление размеров при изменении контейнера
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setDimensions(prev => ({ ...prev, width: Math.max(width - 40, 600) }));
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Высота SVG зависит от количества объектов
  const svgHeight = useMemo(() => {
    const baseHeight = 180;
    const objectsHeight = uniqueObjects.length * 40;
    return Math.max(baseHeight + objectsHeight, 350);
  }, [uniqueObjects.length]);

  // Сброс к данным из симуляции
  const resetToSimulationData = () => {
    setIsUsingExternalData(true);
    if (propEvents && propEvents.length > 0) {
      const runsByNumber = new Map();
      propEvents.forEach(event => {
        const runNum = event.run_number || 1;
        if (!runsByNumber.has(runNum)) runsByNumber.set(runNum, []);
        runsByNumber.get(runNum).push(event);
      });
      
      const parsedRuns = Array.from(runsByNumber.keys())
        .sort((a, b) => a - b)
        .map(run => ({
          number: run,
          events: runsByNumber.get(run),
          eventCount: runsByNumber.get(run).length,
          startTime: runsByNumber.get(run)[0]?.timestamp_begin || 0,
          endTime: runsByNumber.get(run).reduce((max, e) => Math.max(max, e.timestamp_begin || 0), 0)
        }));
      
      setRuns(parsedRuns);
      setSelectedRunIndex(0);
      setLocalEvents(parsedRuns[0]?.events || []);
    }
  };

  const hasData = events.length > 0;

  return (
    <div className="timeline-visualization" ref={containerRef}>
      <div className="timeline-header">
        <h4>
          Визуализация процесса моделирования
          {!isUsingExternalData && <span className="data-badge">Загружено из CSV</span>}
        </h4>
        
        <div className="timeline-controls">
            {(allRuns && allRuns.length > 0) || (runs && runs.length > 0) ? (
            <select 
                className="run-selector"
                value={isUsingExternalData && propIsShowingHistory ? String(propCurrentRunIndex + 1) : 
                    (!isUsingExternalData && selectedRunIndex >= 0 ? String(selectedRunIndex + 1) : 'current')}
                onChange={(e) => {
                const val = e.target.value;
                if (val === 'current') {
                    if (isUsingExternalData) {
                    onBackToCurrent?.();
                    } else {
                    // Для CSV режима - показать текущий (первый) запуск
                    setSelectedRunIndex(0);
                    setLocalEvents(runs[0]?.events || []);
                    }
                } else {
                    const runNum = parseInt(val);
                    if (isUsingExternalData) {
                    onRunSelect?.(runNum);
                    } else {
                    // Для CSV режима - переключение между запусками
                    const runIndex = runNum - 1;
                    if (runs[runIndex]) {
                        setSelectedRunIndex(runIndex);
                        setLocalEvents(runs[runIndex].events);
                    }
                    }
                }
                }}
            >
    <option value="current">
      {isUsingExternalData ? '▶ Текущий запуск' : '📁 Все запуски'}
    </option>
    
    {/* Показываем запуски из пропсов (allRuns) для режима симуляции */}
    {isUsingExternalData && allRuns.map(run => (
      <option key={run.runNumber} value={run.runNumber}>
        Запуск #{run.runNumber} ({run.events.length} событий)
      </option>
    ))}
    
    {/* Показываем запуски из CSV (runs) для режима загруженного файла */}
    {!isUsingExternalData && runs.map((run, idx) => (
      <option key={run.number} value={idx + 1}>
        Запуск #{run.number}
      </option>
    ))}
  </select>
) : null}
          
          {!isUsingExternalData && selectedRunIndex >= 0 && runs[selectedRunIndex] && (
            <div className="run-stats">
              <span className="stat-badge">📊 Событий: {runs[selectedRunIndex].eventCount}</span>
              <span className="stat-badge">⏱️ Длительность: {formatTime(runs[selectedRunIndex].endTime)}</span>
              <span className="stat-badge">🎯 Действий: {actions.length}</span>
            </div>
          )}
          
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button 
            className="upload-csv-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Загрузить журнал событий из CSV"
          >
            Загрузить CSV
          </button>

          <button 
            className="report-btn"
            onClick={onShowReport}
            title="Посмотреть отчёт по запускам"
            disabled={(!allRuns || allRuns.length === 0) && (!runs || runs.length === 0)}
          >
            Посмотреть отчёт
          </button>
          
          {!isUsingExternalData && (
            <button 
              className="reset-btn"
              onClick={resetToSimulationData}
              title="Вернуться к данным из симуляции"
            >
              Сбросить
            </button>
          )}
        </div>
      </div>
      
      {hasData ? (
        <>
          <div className="timeline-svg-container">
            <svg
              ref={svgRef}
              width={dimensions.width}
              height={svgHeight}
              viewBox={`0 0 ${dimensions.width} ${svgHeight}`}
              className="timeline-svg"
            >
              {renderTimeline()}
              {renderActionBlocks()}
              {renderEventPoints()}
              {renderObjectLayers()}
            </svg>
          </div>
          {renderLegend()}
        </>
      ) : (
        <div className="timeline-empty">
          <div className="empty-icon">📊</div>
          <div className="empty-text">Нет данных для отображения</div>
          <div className="empty-hint">
            Запустите моделирование для генерации событий<br/>
            или загрузите CSV-файл с журналом событий
          </div>
        </div>
      )}
      
      {tooltip.show && (
        <div
          className="timeline-tooltip"
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%) translateY(-100%)'
          }}
        >
          {getTooltipContent(tooltip.content)}
          <div className="tooltip-arrow" />
        </div>
      )}
    </div>
  );
};

export default TimelineVisualization;