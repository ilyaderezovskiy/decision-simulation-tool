// EventLogger.js
class EventLogger {
  constructor() {
    this._events = [];
    this._simulationId = null;
    this._runNumber = 0;
    this._runStartTime = null;
    this._counter = 0;
  }

  // Генератор простых ID
  _nextId() {
    this._counter++;
    return this._counter;
  }

  startSeries() {
    this._events = [];
    this._simulationId = `sim_${Date.now()}`;
    this._runNumber = 0;
    this._runStartTime = null;
    this._counter = 0;
    return this._simulationId;
  }

  startRun(runNumber) {
    // Очищаем журнал перед каждым запуском
    this._clearForNewRun();
    
    this._runNumber = runNumber;
    this._runStartTime = Date.now();
    
    // Первый запуск
    const startEvent = this._add({
      activity: `Запуск #${runNumber}`,
      type: 'system',
      iteration: 0,
      attributes: { runNumber }
    });
    return startEvent;
  }

  // Приватный метод для очистки перед новым запуском
  _clearForNewRun() {
    this._events = [];
    this._counter = 0;
  }

  endRun(params = {}) {
    return this._add({
      activity: `Завершение запуска #${this._runNumber}`,
      type: 'system',
      duration_sec: this._elapsed(),
      iteration: params.iteration,
      attributes: {
        runNumber: this._runNumber,
        iterations: params.iteration,
        hasFire: params.hasFire
      }
    });
  }

  // Начало действия
  startAction(params) {
    const eventId = this._nextId();
    const record = this._add({
      id: eventId,
      activity: params.name,
      type: params.isDecision ? 'decision' : 'action',
      iteration: params.iteration,
      duration_sec: null,
      attributes: {
        nodeId: params.nodeId,
        responsible: params.responsible || '',
        parallel: !!params.parallel,
        decisionNodeName: params.decisionNodeName || null
      }
    });
    return record;
  }

  // Завершение действия
  endAction(actionId, elapsedSec) {
    const record = this._events.find(e => e.id === actionId);
    if (record) {
      record.duration_sec = parseFloat(elapsedSec.toFixed(2));
    }
    return record;
  }

  // Событие по окончании действия (связь action -> event)
  addCompletionEvent(params) {
    const eventId = this._nextId();
    const record = this._add({
      id: eventId,
      activity: params.eventName,
      type: 'event',
      iteration: params.iteration,
      cause_id: params.causeActionId,
      attributes: {
        sourceNodeId: params.nodeId,
        sourceNodeName: params.nodeName
      }
    });
    
    if (params.causeActionId) {
      const actionRecord = this._events.find(e => e.id === params.causeActionId);
      if (actionRecord) {
        actionRecord.result_id = eventId;
      }
    }
    
    return record;
  }

  // Выбор ветки в Decision Node
  addDecisionChoice(params) {
    const alreadyExists = this._events.some(e => 
        e.type === 'decision' && 
        e.attributes?.decisionNodeId === params.decisionNodeId &&
        e.run_number === this._runNumber
    );
    
    if (alreadyExists) return null;
    return this._add({
        activity: `${params.selectedBranch}`,
        type: 'decision',
        iteration: params.iteration,
        duration_sec: params.duration_sec || 0,
        attributes: {
        decisionNodeId: params.decisionNodeId,
        decisionNodeName: params.decisionNodeName,
        selectedBranch: params.selectedBranch
        }
    });
  }

  // Объект попал в зону - ИСПРАВЛЕНО имя метода
  addObjectAffected(params) {
    console.log(`📍 [ЛОГ] Объект в зоне: ${params.objectName} (интенсивность: ${params.intensity})`);
    
    return this._add({
      activity: `${params.objectName} в зоне воздействия`,
      type: 'object',
      iteration: params.iteration,
      cause_id: params.causeId || null,
      attributes: {
        objectId: params.objectId,
        objectName: params.objectName,
        objectType: params.objectType,
        intensity: params.intensity,
        position: params.position
      }
    });
  }

  // Изменение объекта
  objectChanged(params) {
    console.log(`[ЛОГ] Изменение объекта: ${params.objectName} → ${params.property}: ${params.previousValue} → ${params.newValue}`);
    
    return this._add({
        activity: `${params.objectName}: ${params.property} → ${params.newValue}`,
        type: 'object',
        iteration: params.iteration,
        cause_id: params.causeId || null,
        attributes: params.attributes || {
          objectId: params.objectId,
          objectName: params.objectName,
          property: params.property,
          previousValue: params.previousValue,
          newValue: params.newValue,
        }
    });
  }

  // Событие активировано - НОВЫЙ МЕТОД
  addEventTriggered(params) {
    console.log(`⚡ [ЛОГ] Активация события: ${params.eventName} → ${params.details || ''}`);
    
    return this._add({
      activity: `${params.eventName}`,
      type: 'event',
      iteration: params.iteration,
      cause_id: params.causeId || null,
      attributes: {
        eventId: params.eventId,
        eventName: params.eventName,
        condition: params.condition,
        threshold: params.threshold,
        actualValue: params.actualValue,
        details: params.details
      }
    });
  }

  // Системное событие
  systemEvent(params) {
    return this._add({
      activity: params.eventName,
      type: 'object',
      iteration: params.iteration,
      attributes: params.attributes || {}
    });
  }

  // Условие нарушено
  conditionViolation(params) {
    console.log(`⚠️ [ЛОГ] Нарушение условия: ${params.actionName} → ${params.description}`);
    
    return this._add({
      activity: `ПРЕРЫВАНИЕ: ${params.actionName}`,
      type: 'condition_violation',
      iteration: params.iteration,
      attributes: {
        nodeId: params.nodeId,
        description: params.description
      }
    });
  }

  // Симуляционное событие (для совместимости)
  simulationEvent(params) {
    return this._add({
      activity: params.activity || params.eventName,
      type: params.type || 'simulation',
      iteration: params.iteration,
      cause_id: params.causeId || null,
      attributes: params.attributes || {}
    });
  }

  getElapsedTime() {
    return this._elapsed();
  }

  getAbsoluteTimestamp() {
    return Date.now();
  }

  getEvents() { 
    return this._events; 
  }

  exportCSV() {
    const headers = ['ID', 'Run', 'Iteration', 'Activity', 'Timestamp (sec)', 'Duration(sec)', 'Type', 'Cause ID', 'Result ID', 'Attributes'];
    const rows = this._events.map(e => [
      e.id,
      e.run_number,
      e.iteration ?? '',
      e.activity,
      e.timestamp_begin ?? '',
      e.duration_sec ?? '',
      e.type,
      e.cause_id ?? '',
      e.result_id ?? '',
      JSON.stringify(e.attributes)
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    
    return [headers.join(','), ...rows].join('\n');
  }

  downloadCSV(filename = 'simulation_events.csv') {
    const blob = new Blob(['\ufeff' + this.exportCSV()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  clear() {
    this._events = [];
    this._runNumber = 0;
    this._counter = 0;
  }

  _elapsed() {
    if (!this._runStartTime) return 0;
    return (Date.now() - this._runStartTime) / 1000;
  }

  _getAbsoluteTimestamp() {
    return Date.now();
  }

  _add(data) {
    const record = {
      id: data.id ?? this._nextId(),
      simulation_id: this._simulationId,
      run_number: this._runNumber,
      timestamp_begin: this._elapsed(),
      timestamp_absolute: this._getAbsoluteTimestamp(),
      iteration: data.iteration ?? null,
      activity: data.activity || '',
      duration_sec: data.duration_sec ?? null,
      type: data.type || 'event',
      cause_id: data.cause_id ?? null,
      result_id: data.result_id ?? null,
      attributes: data.attributes || {}
    };
    this._events.push(record);
    return record;
  }
}

const eventLogger = new EventLogger();
export default eventLogger;