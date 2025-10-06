require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    console.log('Connecting to:', process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 12000,
      family: 4,      // prefer IPv4
      tls: true,      // ensure TLS
      directConnection: false,
    });
    console.log('✅ Connected successfully!');
    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  }
})();
