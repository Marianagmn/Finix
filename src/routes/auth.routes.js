feat(error-handling): implement centralized error middleware with AppError class

- Create AppError class extending native Error with statusCode and machine-readable code
- Add semantic factory methods (AppError.unauthorized(), AppError.notFound(), etc.)
- Implement global Express error handler
- Normalize common errors including Mongoose and JWT errors
- Standardize error responses across the application