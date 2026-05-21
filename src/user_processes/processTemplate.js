// processTemplate.js - шаблон для процессов моделирования

/**
 * Шаблон процесса моделирования
 * Пользователи должны загружать файл .js с такой структурой
 */

const processTemplate = {
    // Обязательные поля
    id: 'unique_process_id',           // Уникальный идентификатор процесса
    name: 'Название процесса',          // Отображаемое название
    version: '1.0.0',                   // Версия
    
    // Типы объектов, используемые в процессе
    objectTypes: [
      {
        id: 'building',                  // Уникальный ID типа объекта
        name: 'Здание',                   // Отображаемое название
        icon: '🏢',                        // Иконка для отображения
        defaultProperties: {              // Свойства по умолчанию
          resistance: 70,                  // Устойчивость к процессу (%)
          destructionTemp: 300,            // Температура разрушения
          material: 'concrete',            // Материал
          // Другие специфичные свойства
        },
        description: 'Описание типа объекта'
      },
      // Другие типы объектов
    ],
    
    // Параметры среды (окружения)
    environmentParams: [
      {
        id: 'windSpeed',                  // ID параметра
        name: 'Скорость ветра',            // Отображаемое название
        type: 'number',                    // Тип данных: number, boolean, string
        defaultValue: 5,                    // Значение по умолчанию
        min: 0,                             // Минимальное значение (для number)
        max: 20,                            // Максимальное значение (для number)
        unit: 'м/с',                        // Единица измерения
        description: 'Скорость ветра'
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
        description: 'Относительная влажность'
      },
      {
        id: 'temperature',
        name: 'Температура воздуха',
        type: 'number',
        defaultValue: 20,
        min: -50,
        max: 100,
        unit: '°C',
        description: 'Температура воздуха'
      }
    ],
    
    // Функция инициализации клеточного автомата
    initialize: (width, height, environmentParams, objects) => {
      /**
       * Инициализирует состояние клеточного автомата
       * @param {number} width - ширина области в клетках
       * @param {number} height - высота области в клетках
       * @param {Object} environmentParams - начальные параметры среды
       * @param {Array} objects - размещенные объекты
       * @returns {Object} начальное состояние автомата
       */
      
      return {
        grid: Array(height).fill().map(() => Array(width).fill(0)),
        state: 'initial',
        // Другие данные состояния
      };
    },
    
    // Функция шага моделирования
    step: (currentState, environmentParams, objects, events) => {
      /**
       * Выполняет один шаг моделирования
       * @param {Object} currentState - текущее состояние автомата
       * @param {Object} environmentParams - текущие параметры среды
       * @param {Array} objects - текущие объекты с их состоянием
       * @param {Array} events - события, сгенерированные на предыдущем шаге
       * @returns {Object} новое состояние и сгенерированные события
       */
      
      // Логика клеточного автомата
      const newState = { ...currentState };
      const newEvents = [];
      
      // Пример: распространение пожара
      for (let y = 0; y < currentState.grid.length; y++) {
        for (let x = 0; x < currentState.grid[0].length; x++) {
          // Логика распространения
          if (currentState.grid[y][x] > 0) {
            // Распространение на соседние клетки
            // ...
          }
        }
      }
      
      // Проверка взаимодействия с объектами
      objects.forEach(obj => {
        if (isAffected(obj, currentState)) {
          newEvents.push({
            type: 'object_affected',
            objectId: obj.id,
            objectType: obj.objectType,
            position: { x: obj.x, y: obj.y },
            timestamp: Date.now(),
            details: 'Объект попал в зону воздействия'
          });
        }
      });
      
      return {
        state: newState,
        events: newEvents,
        environmentParams: { ...environmentParams } // Могут меняться
      };
    },
    
    // Функция проверки завершения
    isComplete: (state, maxIterations) => {
      /**
       * Проверяет, завершен ли процесс
       * @param {Object} state - текущее состояние
       * @param {number} maxIterations - максимальное число итераций
       * @returns {boolean} true если процесс завершен
       */
      
      return state.iterations >= maxIterations || state.grid.every(row => row.every(cell => cell === 0));
    },
    
    // Функция получения цвета клетки для отображения
    getCellColor: (cellValue) => {
      /**
       * Возвращает цвет для отображения клетки
       * @param {number} cellValue - значение клетки
       * @returns {string} цвет в формате HEX или rgba
       */
      
      const colors = {
        0: 'transparent',
        1: '#ffcccc',
        2: '#ff9999',
        3: '#ff6666',
        4: '#ff3333',
        5: '#ff0000'
      };
      return colors[cellValue] || 'transparent';
    }
  };
  
  export default processTemplate;