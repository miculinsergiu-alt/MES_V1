const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { usersDb } = require('../db/init');
const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { badge_number, password } = req.body;
  if (!badge_number || !password) {
    return res.status(400).json({ error: 'Numărul de legitimație și parola sunt obligatorii' });
  }
  const user = usersDb.prepare('SELECT * FROM users WHERE badge_number = ? AND active = 1').get(badge_number);
  if (!user) return res.status(401).json({ error: 'Legitimație sau parolă incorectă' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Legitimație sau parolă incorectă' });

  const token = jwt.sign(
    { id: user.id, badge_number: user.badge_number, role: user.role, first_name: user.first_name, last_name: user.last_name },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { id: user.id, first_name: user.first_name, last_name: user.last_name, badge_number: user.badge_number, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token lipsă' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json(decoded);
  } catch {
    res.status(403).json({ error: 'Token invalid' });
  }
});

module.exports = router;
