const jwt = require('jsonwebtoken');
const { usersDb } = require('../db/init');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token lipsă' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalid sau expirat' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Neautentificat' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acces interzis pentru rolul tău' });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole };
