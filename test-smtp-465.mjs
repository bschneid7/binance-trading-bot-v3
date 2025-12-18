import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,  // Use SSL
  auth: {
    user: 'bschneid7@gmail.com',
    pass: 'hlhvcdwvudtomhkr'
  }
});

console.log('Testing SMTP connection on port 465 (SSL)...');
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ SMTP Error:', error.message);
  } else {
    console.log('✅ SMTP connection successful!');
  }
  process.exit(error ? 1 : 0);
});

setTimeout(() => {
  console.log('⏱️  Timeout - no response from SMTP server');
  process.exit(1);
}, 10000);
