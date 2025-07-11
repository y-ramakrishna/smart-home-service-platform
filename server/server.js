const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const Razorpay = require('razorpay');

const app = express();
const PORT = 3000;

// Razorpay setup (replace with your real keys)
const razorpay = new Razorpay({
  key_id: 'rzp_test_uBhJGj6JxW8q4B',
  key_secret: 'f191fGWAQut8ohKC7I4jBBRc',
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// SQLite DB setup
const db = new sqlite3.Database('./househelp.db', (err) => {
  if (err) return console.error('DB connection error:', err.message);
  console.log('Connected to SQLite');
});

// Create tables if not exist and preload servants
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS servants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      services TEXT,
      experience TEXT,
      charge INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      servantId INTEGER,
      date TEXT,
      paymentId TEXT,
      amount INTEGER,
      status TEXT,
      FOREIGN KEY(userId) REFERENCES users(id),
      FOREIGN KEY(servantId) REFERENCES servants(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      servantId INTEGER,
      user TEXT,
      rating INTEGER,
      comment TEXT
    )
  `);

  // Preload default servants only if not already present
  const defaultServants = [
    { name: "Ram Kumar", services: "Cleaning, Cooking", experience: "5 years", charge: 300 },
    { name: "Sita Devi", services: "Babysitting, Cleaning", experience: "3 years", charge: 250 },
    { name: "John Smith", services: "Gardening, Plumbing", experience: "7 years", charge: 400 },
    { name: "Anita Sharma", services: "Cooking, Laundry", experience: "4 years", charge: 280 },
    { name: "Ravi Patel", services: "Driving, Security", experience: "6 years", charge: 350 },
    { name: "Neha Singh", services: "Elderly Care, Cleaning", experience: "5 years", charge: 320 },
    { name: "Mohit Gupta", services: "Electrician, Plumbing", experience: "8 years", charge: 450 },
    { name: "Pooja Reddy", services: "Cooking, Babysitting", experience: "4 years", charge: 270 },
    { name: "Amit Verma", services: "Cleaning, Gardening", experience: "6 years", charge: 310 },
    { name: "Sunita Joshi", services: "Laundry, Cooking", experience: "5 years", charge: 290 },
    { name: "Vikram Mehta", services: "Security, Driving", experience: "7 years", charge: 380 },
    { name: "Rekha Nair", services: "Babysitting, Cleaning", experience: "3 years", charge: 260 },
    { name: "Suresh Kumar", services: "Electrician, Maintenance", experience: "8 years", charge: 440 },
    { name: "Kavita Das", services: "Cooking, Laundry", experience: "4 years", charge: 275 },
    { name: "Arjun Singh", services: "Gardening, Security", experience: "6 years", charge: 330 },
  ];

  defaultServants.forEach(servant => {
    db.get(`SELECT * FROM servants WHERE name = ?`, [servant.name], (err, row) => {
      if (err) console.error('Error checking servant:', err);
      if (!row) {
        db.run(
          `INSERT INTO servants (name, services, experience, charge) VALUES (?, ?, ?, ?)`,
          [servant.name, servant.services, servant.experience, servant.charge]
        );
      }
    });
  });
});

// ----------- ROUTES ------------

// Register
app.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Please provide name, email, password and role' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
      [name, email, hashed, role],
      function (err) {
        if (err) return res.status(500).json({ error: 'Email already exists or DB error' });
        res.json({ id: this.lastID, message: 'User registered successfully' });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Please provide email and password' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Return minimal user info (no password)
    res.json({ id: user.id, name: user.name, role: user.role });
  });
});

// Add servant (for admin or servant onboarding)
app.post('/servants', (req, res) => {
  const { name, services, experience, charge } = req.body;
  if (!name || !services || !experience || !charge) {
    return res.status(400).json({ error: 'Please provide all servant details' });
  }

  db.run(
    `INSERT INTO servants (name, services, experience, charge) VALUES (?, ?, ?, ?)`,
    [name, services, experience, charge],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ id: this.lastID, message: 'Servant added successfully' });
    }
  );
});

// Get servants with average rating
app.get('/servants', (req, res) => {
  const sql = `
    SELECT s.*, 
      IFNULL(ROUND(AVG(r.rating), 1), 0) AS avgRating
    FROM servants s
    LEFT JOIN reviews r ON s.id = r.servantId
    GROUP BY s.id
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// Get reviews for a servant
app.get('/servants/:id/reviews', (req, res) => {
  const id = req.params.id;
  db.all(`SELECT * FROM reviews WHERE servantId = ?`, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// Create Razorpay order
app.post('/create-order', (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  razorpay.orders.create(
    {
      amount: amount * 100, // in paise
      currency: 'INR',
      receipt: 'receipt_' + Date.now(),
    },
    (err, order) => {
      if (err) return res.status(500).json({ error: 'Order creation failed' });
      res.json(order);
    }
  );
});

// Book servant after payment
app.post('/book', (req, res) => {
  const { userId, servantId, date, paymentId, amount } = req.body;
  if (!userId || !servantId || !date || !paymentId || !amount) {
    return res.status(400).json({ error: 'Missing booking info' });
  }

  db.run(
    `INSERT INTO bookings (userId, servantId, date, paymentId, amount, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, servantId, date, paymentId, amount, 'paid'],
    function (err) {
      if (err) return res.status(500).json({ error: 'Booking failed' });
      res.json({ bookingId: this.lastID, message: 'Booking successful' });
    }
  );
});

// Get bookings for a user
app.get('/bookings/:userId', (req, res) => {
  const userId = req.params.userId;
  db.all(`SELECT * FROM bookings WHERE userId = ?`, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// Dashboard stats
app.get('/dashboard', (req, res) => {
  db.serialize(() => {
    db.get(`SELECT COUNT(*) as totalServants FROM servants`, (err, sRow) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      db.get(`SELECT COUNT(*) as totalBookings FROM bookings`, (err, bRow) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        db.get(`SELECT COUNT(*) as totalReviews FROM reviews`, (err, rRow) => {
          if (err) return res.status(500).json({ error: 'DB error' });
          db.get(`SELECT IFNULL(SUM(amount),0) as totalEarnings FROM bookings WHERE status = 'paid'`, (err, eRow) => {
            if (err) return res.status(500).json({ error: 'DB error' });

            res.json({
              totalServants: sRow.totalServants,
              totalBookings: bRow.totalBookings,
              totalReviews: rRow.totalReviews,
              totalEarnings: eRow.totalEarnings,
            });
          });
        });
      });
    });
  });
});

// Add review
app.post('/reviews', (req, res) => {
  const { servantId, user, rating, comment } = req.body;
  if (!servantId || !user || !rating) {
    return res.status(400).json({ error: 'Missing review info' });
  }

  db.run(
    `INSERT INTO reviews (servantId, user, rating, comment) VALUES (?, ?, ?, ?)`,
    [servantId, user, rating, comment || ''],
    function (err) {
      if (err) return res.status(500).json({ error: 'Could not add review' });
      res.json({ id: this.lastID, message: 'Review added successfully' });
    }
  );
});

const port = 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});