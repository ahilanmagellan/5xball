// Оборачивает async-роут, чтобы отклонённый промис уходил в errorHandler,
// а не "подвешивал" запрос без ответа.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Утилита для предсказуемых HTTP-ошибок: throw new HttpError(400, 'сообщение')
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
