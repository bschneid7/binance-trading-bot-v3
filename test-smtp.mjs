import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'bschneid7@gmail.com',
    pass: 'hlhvcdwvudtomhkr'
  }
});

console.log('Testing SMTP connection...');
transporter.verify((error, success) => {
  if (error) {
    console.log('SMTP Error:', error);
  } else {
    console.log('✅ SMTP connection successful!');
  }
  process.exit(0);
});

setTimeout(() => {
  console.log('Timeout - no response from SMTP server');
  process.exit(1);
}, 10000);
