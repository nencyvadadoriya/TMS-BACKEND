const nodemailer = require('nodemailer');
require('dotenv').config();

let sendgridTransport;
try {
    sendgridTransport = require('nodemailer-sendgrid-transport');
} catch (e) {
    sendgridTransport = null;
}

console.log('🔧 Email Configuration Check:');
console.log('USER_EMAIL:', process.env.USER_EMAIL || '❌ Missing');
console.log('USER_PASS_KEY:', process.env.USER_PASS_KEY ? '✅ Set (length: ' + process.env.USER_PASS_KEY.length + ')' : '❌ Missing');
console.log('SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '✅ Set (length: ' + process.env.SENDGRID_API_KEY.length + ')' : '❌ Missing');
console.log('EMAIL_FROM:', process.env.EMAIL_FROM || '❌ Missing');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

// Create transporter with detailed error handling
const createTransporter = () => {
    try {
        const usingSendGrid = Boolean(process.env.SENDGRID_API_KEY);

        if (usingSendGrid) {
            if (!sendgridTransport) {
                console.error('❌ SENDGRID_API_KEY is set but nodemailer-sendgrid-transport is not installed');
                console.error('Install it with: npm i nodemailer-sendgrid-transport');
                return null;
            }

            const transporter = nodemailer.createTransport(
                sendgridTransport({
                    auth: {
                        api_key: process.env.SENDGRID_API_KEY
                    }
                })
            );

            transporter.verify((error) => {
                if (error) {
                    console.error('❌ SendGrid transporter verification failed:', {
                        message: error.message,
                        code: error.code,
                        command: error.command
                    });
                } else {
                    console.log('✅ SendGrid email transport is ready');
                }
            });

            return transporter;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            host: 'smtp.gmail.com',
            port: 587,
            secure: false, // Use TLS
            auth: {
                user: process.env.USER_EMAIL,
                pass: process.env.USER_PASS_KEY
            },
            tls: {
                ciphers: 'SSLv3',
                rejectUnauthorized: false
            }
        });

        // Verify connection
        transporter.verify((error, success) => {
            if (error) {
                console.error('❌ Email transporter verification failed:', {
                    message: error.message,
                    code: error.code,
                    command: error.command
                });
                
                // Check specific errors
                if (error.code === 'EAUTH') {
                    console.error('⚠️ Authentication failed. Check:');
                    console.error('1. Is 2-Step Verification enabled on Google Account?');
                    console.error('2. Is the App Password correct?');
                    console.error('3. Try generating a new App Password');
                }
            } else {
                console.log('✅ Email server is ready to send messages');
            }
        });

        return transporter;
    } catch (error) {
        console.error('❌ Failed to create email transporter:', error.message);
        return null;
    }
};

let transporter = createTransporter();

// Send OTP Email with comprehensive error handling
exports.sendOtpEmail = async (email, otp, name = 'User') => {
    try {
        console.log(`📤 [${new Date().toISOString()}] Attempting to send OTP to: ${email}`);
        
        // Validate inputs
        if (!email || !otp) {
            console.error('❌ Missing email or OTP');
            return false;
        }

        const fromAddress = process.env.EMAIL_FROM || process.env.USER_EMAIL;
        const usingSendGrid = Boolean(process.env.SENDGRID_API_KEY);

        if (usingSendGrid) {
            if (!process.env.SENDGRID_API_KEY) {
                console.error('❌ SENDGRID_API_KEY not found in environment');
                return false;
            }
            if (!fromAddress) {
                console.error('❌ EMAIL_FROM (or USER_EMAIL) not found in environment');
                return false;
            }
        } else {
            if (!process.env.USER_EMAIL || !process.env.USER_PASS_KEY) {
                console.error('❌ Email credentials not found in environment');
                console.log('Please check environment variables:');
                console.log('- USER_EMAIL should be a Gmail address');
                console.log('- USER_PASS_KEY should be 16-character App Password');
                return false;
            }
        }

        // Check transporter
        if (!transporter) {
            transporter = createTransporter();
        }

        if (!transporter) {
            console.error('❌ Email transporter not initialized');
            return false;
        }

        const mailOptions = {
            from: {
                name: 'Task Management System',
                address: fromAddress
            },
            to: email,
            subject: 'Password Reset OTP - Task Management System',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>OTP Verification</title>
                </head>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; font-size: 28px;">🔐 Password Reset OTP</h1>
                            <p style="margin: 10px 0 0 0; opacity: 0.9;">Task Management System</p>
                        </div>
                        
                        <div style="padding: 40px 30px;">
                            <h2 style="color: #333; margin-top: 0;">Hello ${name},</h2>
 　 　 　 　 　 　 　 　 <p style="color: #555; line-height: 1.6; font-size: 16px;">
 　 　 　 　 　 　 　 　 　 You requested to reset your password. Please use the One-Time Password (OTP) below to verify your identity:
 　 　 　 　 　 　 　 　 </p>
 　 　 　 　 　 　 　 　 <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
                                            color: white; 
                                            border-radius: 12px; 
                                            padding: 25px; 
                                            text-align: center; 
                                            margin: 30px 0; 
                                            font-size: 42px; 
                                            font-weight: bold; 
                                            letter-spacing: 15px; 
                                            box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                                ${otp}
                            </div>
 　 　 　 　 　 　 　 　 <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
 　 　 　 　 　 　 　 　 　 <p style="margin: 0; color: #856404;">
 　 　 　 　 　 　 　 　 　 　 <strong>⚠️ Important:</strong> 
 　 　 　 　 　 　 　 　 　 　 <ul style="margin: 10px 0 0 0; padding-left: 20px;">
 　 　 　 　 　 　 　 　 　 　 　 <li>This OTP is valid for <strong>2 minutes</strong> only</li>
 　 　 　 　 　 　 　 　 　 　 　 <li>Do not share this OTP with anyone</li>
 　 　 　 　 　 　 　 　 　 　 　 <li>If you didn't request this, please ignore this email</li>
 　 　 　 　 　 　 　 　 　 　 </ul>
 　 　 　 　 　 　 　 　 　 </p>
 　 　 　 　 　 　 　 　 </div>
 　 　 　 　 　 　 　 　 <p style="color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
 　 　 　 　 　 　 　 　 　 Need help? Contact our support team or reply to this email.
 　 　 　 　 　 　 　 　 </p>
                        </div>
                        
                        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6;">
                            <p style="margin: 5px 0;">© ${new Date().getFullYear()} Task Management System. All rights reserved.</p>
                            <p style="margin: 5px 0;">This is an automated message, please do not reply directly.</p>
                            <p style="margin: 5px 0;">
                                <a href="#" style="color: #6c757d; text-decoration: none;">Privacy Policy</a> | 
                                <a href="#" style="color: #6c757d; text-decoration: none;">Terms of Service</a>
                            </p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            // Plain text version for email clients that don't support HTML
            text: `
                PASSWORD RESET OTP - TASK MANAGEMENT SYSTEM
                =============================================
                
                Hello ${name},
                
                You requested to reset your password. Use this OTP to verify your identity:
                
                OTP: ${otp}
                
                ⚠️ Important:
                • This OTP is valid for 2 minutes only
                • Do not share this OTP with anyone
                • If you didn't request this, please ignore this email
                
                Need help? Contact our support team.
                
                © ${new Date().getFullYear()} Task Management System
                This is an automated message.
            `
        };

        console.log('📧 Sending email with options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });

        // Send email
        const info = await transporter.sendMail(mailOptions);
        
        console.log('✅ Email sent successfully!');
        console.log('📨 Message ID:', info.messageId);
        console.log('📧 Response:', info.response);
        
        return true;
        
    } catch (error) {
        console.error('❌ Email sending failed with details:');
        console.error('Error Message:', error.message);
        console.error('Error Code:', error.code);
        console.error('Error Command:', error.command);
        console.error('Error Response Code:', error.responseCode);
        console.error('Error Response:', error.response);
        
        // Specific error handling
        if (error.code === 'EAUTH') {
            console.error('\n🔐 AUTHENTICATION FAILED - SOLUTIONS:');
            console.error('1. Go to: https://myaccount.google.com/security');
            console.error('2. Enable "2-Step Verification"');
            console.error('3. Generate new "App Password" for Mail');
            console.error('4. Update USER_PASS_KEY in Render.com');
            console.error('5. Current USER_PASS_KEY length:', process.env.USER_PASS_KEY?.length);
        }
        
        return false;
    }
};

exports.sendAccountCreatedEmail = async ({
    toEmail,
    toName = 'User',
    createdByName = 'User',
    createdByEmail,
    role = 'assistant',
    password
}) => {
    try {
        const safeTo = (toEmail || '').toString().trim().toLowerCase();

        if (!safeTo) {
            console.error('❌ Missing toEmail for account created email');
            return false;
        }

        const fromAddress = process.env.EMAIL_FROM || process.env.USER_EMAIL;
        const usingSendGrid = Boolean(process.env.SENDGRID_API_KEY);

        if (usingSendGrid) {
            if (!process.env.SENDGRID_API_KEY) {
                console.error('❌ SENDGRID_API_KEY not found in environment');
                return false;
            }
            if (!fromAddress) {
                console.error('❌ EMAIL_FROM (or USER_EMAIL) not found in environment');
                return false;
            }
        } else {
            if (!process.env.USER_EMAIL || !process.env.USER_PASS_KEY) {
                console.error('❌ Email credentials not found in environment');
                return false;
            }
        }

        if (!transporter) {
            transporter = createTransporter();
        }

        if (!transporter) {
            console.error('❌ Email transporter not initialized');
            return false;
        }

        const fromLine = createdByEmail ? `${createdByName} (${createdByEmail})` : createdByName;
        const safeRole = (role || 'assistant').toString();
        const safePassword = (password || '').toString();

        const fromDisplayName = createdByName
            ? `Task Management System (Invited by ${createdByName})`
            : 'Task Management System';

        const invitedBySubject = createdByEmail
            ? `${createdByName} <${createdByEmail}>`
            : createdByName;

        const mailOptions = {
            from: {
                name: fromDisplayName,
                address: fromAddress
            },
            replyTo: createdByEmail || undefined,
            to: safeTo,
            subject: `Welcome to Task Management System - Invited by ${invitedBySubject}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Welcome</title>
                </head>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; font-size: 24px;">Welcome to Task Management System</h1>
                            <p style="margin: 10px 0 0 0; opacity: 0.9;">Your account has been created</p>
                        </div>
                        <div style="padding: 30px;">
                            <h2 style="color: #333; margin-top: 0;">Hello ${toName},</h2>
                            <p style="color: #555; line-height: 1.6; font-size: 16px;">
                                You have been added to the Task Management System by <strong>${fromLine}</strong>.
                            </p>
                            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin: 20px 0;">
                                <p style="margin: 0 0 10px 0; color: #333;"><strong>Role:</strong> ${safeRole}</p>
                                <h3 style="margin: 20px 0 10px 0; color: #333;">Login Details</h3>
                                <p style="margin: 0 0 10px 0; color: #333;"><strong>Email:</strong> ${safeTo}</p>
                                ${safePassword ? `<p style="margin: 0; color: #333;"><strong>Password:</strong> ${safePassword}</p>` : ''}
                            </div>
                            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                <p style="margin: 0; color: #856404;">
                                    <strong>For security:</strong> please change your password after login.
                                </p>
                            </div>
                            <p style="color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
                                This is an automated email. Please do not reply.
                            </p>
                        </div>
                        <div style="background: #f8f9fa; padding: 16px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6;">
                            <p style="margin: 0;">© ${new Date().getFullYear()} Task Management System</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
WELCOME TO TASK MANAGEMENT SYSTEM
Your account has been created

Hello ${toName},
You have been added to the Task Management System by ${fromLine}.

Role: ${safeRole}

Login Details

Email: ${safeTo}
${safePassword ? `Password: ${safePassword}\n` : ''}
For security, please change your password after login.

This is an automated email. Please do not reply.
            `.trim()
        };

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const info = await transporter.sendMail(mailOptions);
                console.log('✅ Account created email sent successfully!', {
                    to: safeTo,
                    messageId: info.messageId,
                    response: info.response,
                    attempt
                });
                return true;
            } catch (error) {
                console.error('❌ Account created email sending failed with details:');
                console.error('Error Message:', error?.message);
                console.error('Error Code:', error?.code);
                console.error('Error Command:', error?.command);
                console.error('Error Response Code:', error?.responseCode);
                console.error('Error Response:', error?.response);

                const code = (error?.code || '').toString();
                const shouldRetry =
                    attempt < maxAttempts
                    && code !== 'EAUTH'
                    && (
                        code === 'ETIMEDOUT'
                        || code === 'ECONNRESET'
                        || code === 'EAI_AGAIN'
                        || code === 'ECONNECTION'
                        || code === 'ESOCKET'
                    );

                if (!shouldRetry) {
                    return false;
                }

                await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                transporter = createTransporter();
                if (!transporter) {
                    return false;
                }
            }
        }

        return false;
    } catch (error) {
        console.error('❌ Account created email sending failed with details:');
        console.error('Error Message:', error?.message);
        console.error('Error Code:', error?.code);
        console.error('Error Command:', error?.command);
        console.error('Error Response Code:', error?.responseCode);
        console.error('Error Response:', error?.response);
        return false;
    }
};

exports.sendTaskAssignedEmail = async ({ toEmail, toName = 'User', assignedByName = 'User', assignedByEmail, task }) => {
    try {
        const safeTo = (toEmail || '').toString().trim().toLowerCase();
        
        if (!safeTo) {
            console.error('❌ Missing toEmail for task assignment email');
            return false;
        }

        const fromAddress = process.env.EMAIL_FROM || process.env.USER_EMAIL;
        const usingSendGrid = Boolean(process.env.SENDGRID_API_KEY);

        if (usingSendGrid) {
            if (!process.env.SENDGRID_API_KEY) {
                console.error('❌ SENDGRID_API_KEY not found in environment');
                return false;
            }
            if (!fromAddress) {
                console.error('❌ EMAIL_FROM (or USER_EMAIL) not found in environment');
                return false;
            }
        } else {
            if (!process.env.USER_EMAIL || !process.env.USER_PASS_KEY) {
                console.error('❌ Email credentials not found in environment');
                return false;
            }
        }

        if (!transporter) {
            transporter = createTransporter();
        }

        if (!transporter) {
            console.error('❌ Email transporter not initialized');
            return false;
        }

        const title = (task?.title || '').toString();
        const priority = (task?.priority || '').toString();
        const status = (task?.status || '').toString();
        const companyName = (task?.companyName || '').toString();
        const brand = (task?.brand || '').toString();
        const dueDate = task?.dueDate ? new Date(task.dueDate) : null;
        const dueDateText = (dueDate && !Number.isNaN(dueDate.getTime())) ? dueDate.toLocaleString() : '';
        
        const fromLine = assignedByEmail ? `${assignedByName} (${assignedByEmail})` : assignedByName;

        const detailsText =
            `Title: ${title || '-'}\n`
            + (companyName ? `Company: ${companyName}\n` : '')
            + (brand ? `Brand: ${brand}\n` : '')
            + (priority ? `Priority: ${priority}\n` : '')
            + (status ? `Status: ${status}\n` : '')
            + (dueDateText ? `Due Date: ${dueDateText}\n` : '');

        const mailOptions = {
            from: {
                name: 'Task Management System',
                address: fromAddress
            },
            replyTo: assignedByEmail || undefined,
            to: safeTo,
            subject: `New Task Assigned: ${title || 'Task'}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>New Task Assigned</title>
                </head>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; font-size: 24px;">New Task Assigned</h1>
                            <p style="margin: 10px 0 0 0; opacity: 0.9;">Task Management System</p>
                        </div>
                        <div style="padding: 30px;">
                            <h2 style="color: #333; margin-top: 0;">Hello ${toName},</h2>
                            <p style="color: #555; line-height: 1.6; font-size: 16px;">
                                You have been assigned a new task by <strong>${fromLine}</strong>.
                            </p>
                            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin: 20px 0;">
                                <p style="margin: 0 0 10px 0; color: #333;"><strong>Title:</strong> ${title || '-'} </p>
                                ${companyName ? `<p style="margin: 0 0 10px 0; color: #333;"><strong>Company:</strong> ${companyName}</p>` : ''}
                                ${brand ? `<p style="margin: 0 0 10px 0; color: #333;"><strong>Brand:</strong> ${brand}</p>` : ''}
                                ${priority ? `<p style="margin: 0 0 10px 0; color: #333;"><strong>Priority:</strong> ${priority}</p>` : ''}
                                ${status ? `<p style="margin: 0 0 10px 0; color: #333;"><strong>Status:</strong> ${status}</p>` : ''}
                                ${dueDateText ? `<p style="margin: 0; color: #333;"><strong>Due Date:</strong> ${dueDateText}</p>` : ''}
                            </div>
                            <p style="color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
                                This is an automated email. Please do not reply.
                            </p>
                        </div>
                        <div style="background: #f8f9fa; padding: 16px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6;">
                            <p style="margin: 0;">© ${new Date().getFullYear()} Task Management System</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
                NEW TASK ASSIGNED
                =================

                Hello ${toName},

                You have been assigned a new task by ${fromLine}.

                ${detailsText}
            `
        };

        const info = await transporter.sendMail(mailOptions);

        console.log('✅ Task assignment email sent successfully!', {
            to: safeTo,
            messageId: info.messageId,
            response: info.response
        });

        return true;
    } catch (error) {
        console.error('❌ Task assignment email sending failed:', error?.message || error);
        return false;
    }
};

// Test function
exports.testEmailService = async (testEmail = 'test@example.com') => {
    console.log('\n🧪 TESTING EMAIL SERVICE...');
    
    const testOtp = Math.floor(100000 + Math.random() * 900000);
    const result = await exports.sendOtpEmail(testEmail, testOtp, 'Test User');
    
    if (result) {
        console.log('✅ Email service test PASSED');
    } else {
        console.log('❌ Email service test FAILED');
    }
    
    return result;
};