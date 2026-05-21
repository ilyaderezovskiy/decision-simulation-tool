// processValidator.js - Валидатор процессов моделирования

/**
 * Проверяет, соответствует ли загруженный объект интерфейсу процесса
 * @param {Object} process - загруженный процесс
 * @returns {Object} результат валидации { isValid: boolean, errors: string[] }
 */
export const validateProcess = (process) => {
    const errors = [];
    const warnings = [];
    
    // Проверка обязательных полей
    if (!process) {
      errors.push('Процесс не может быть пустым');
      return { isValid: false, errors, warnings };
    }
    
    // Проверка id
    if (!process.id || typeof process.id !== 'string') {
      errors.push('Поле "id" обязательно и должно быть строкой');
    } else if (!/^[a-z0-9_]+$/.test(process.id)) {
      warnings.push('Поле "id" должно содержать только буквы нижнего регистра, цифры и подчеркивания');
    }
    
    // Проверка name
    if (!process.name || typeof process.name !== 'string') {
      errors.push('Поле "name" обязательно и должно быть строкой');
    }
    
    // Проверка icon
    if (process.icon && typeof process.icon !== 'string') {
      warnings.push('Поле "icon" должно быть строкой');
    }
    
    // Проверка objectTypes (может быть пустым массивом)
    if (!process.objectTypes) {
      warnings.push('Поле "objectTypes" отсутствует. Будут использованы только стандартные типы объектов');
    } else if (!Array.isArray(process.objectTypes)) {
      errors.push('Поле "objectTypes" должно быть массивом');
    } else {
      process.objectTypes.forEach((type, index) => {
        if (!type.id || typeof type.id !== 'string') {
          errors.push(`objectTypes[${index}]: поле "id" обязательно и должно быть строкой`);
        }
        if (!type.name || typeof type.name !== 'string') {
          errors.push(`objectTypes[${index}]: поле "name" обязательно и должно быть строкой`);
        }
        // defaultProperties может отсутствовать
        if (type.defaultProperties && typeof type.defaultProperties !== 'object') {
          errors.push(`objectTypes[${index}]: поле "defaultProperties" должно быть объектом`);
        }
        // icon может отсутствовать
        if (type.icon && typeof type.icon !== 'string') {
          warnings.push(`objectTypes[${index}]: поле "icon" должно быть строкой`);
        }
      });
    }
    
    // Проверка environmentParams (может быть пустым массивом)
    if (!process.environmentParams) {
      warnings.push('Поле "environmentParams" отсутствует. Будут использованы параметры по умолчанию');
    } else if (!Array.isArray(process.environmentParams)) {
      errors.push('Поле "environmentParams" должно быть массивом');
    } else {
      process.environmentParams.forEach((param, index) => {
        if (!param.id || typeof param.id !== 'string') {
          errors.push(`environmentParams[${index}]: поле "id" обязательно и должно быть строкой`);
        }
        if (!param.name || typeof param.name !== 'string') {
          errors.push(`environmentParams[${index}]: поле "name" обязательно и должно быть строкой`);
        }
        if (param.defaultValue === undefined) {
          errors.push(`environmentParams[${index}]: поле "defaultValue" обязательно`);
        }
        // Проверка типа данных
        if (param.type && !['number', 'string', 'boolean'].includes(param.type)) {
          warnings.push(`environmentParams[${index}]: поле "type" должно быть "number", "string" или "boolean"`);
        }
        // Проверка min/max для чисел
        if (param.type === 'number') {
          if (param.min !== undefined && typeof param.min !== 'number') {
            warnings.push(`environmentParams[${index}]: поле "min" должно быть числом`);
          }
          if (param.max !== undefined && typeof param.max !== 'number') {
            warnings.push(`environmentParams[${index}]: поле "max" должно быть числом`);
          }
        }
      });
    }
    
    // Проверка функций (все обязательны для клеточного автомата)
    if (typeof process.initialize !== 'function') {
      errors.push('Поле "initialize" обязательно и должно быть функцией');
    }
    
    if (typeof process.step !== 'function') {
      errors.push('Поле "step" обязательно и должно быть функцией');
    }
    
    if (typeof process.isComplete !== 'function') {
      errors.push('Поле "isComplete" обязательно и должно быть функцией');
    }
    
    // getCellColor может иметь реализацию по умолчанию, но лучше проверить
    if (process.getCellColor && typeof process.getCellColor !== 'function') {
      errors.push('Поле "getCellColor" должно быть функцией');
    } else if (!process.getCellColor) {
      warnings.push('Поле "getCellColor" отсутствует. Будет использована функция по умолчанию');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
};
  
  /**
   * Проверяет, является ли объект функцией
   * @param {*} obj - проверяемый объект
   * @returns {boolean}
   */
  const isFunction = (obj) => {
    return typeof obj === 'function';
  };