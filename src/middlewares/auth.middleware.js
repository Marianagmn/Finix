// TODO: Implement JWT authentication middleware
// const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Placeholder - implement JWT verification
    // const token = req.headers.authorization?.split(' ')[1];
    // if (!token) return res.status(401).json({ message: 'Unauthorized' });
    
    req.user = { id: 'placeholder-user-id' };
    next();
};

module.exports = authMiddleware;
