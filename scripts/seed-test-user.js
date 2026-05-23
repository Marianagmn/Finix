/**
 * @file seed-test-user.js
 * @description Crea un usuario de prueba en la base de datos para testing
 * 
 * Uso: node scripts/seed-test-user.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function seedTestUser() {
    try {
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ Conectado a MongoDB');

        // Verificar si el usuario de prueba ya existe
        const existingUser = await User.findOne({ email: 'test@example.com' });
        if (existingUser) {
            console.log('⚠️  Usuario de prueba ya existe: test@example.com');
            await mongoose.disconnect();
            return;
        }

        // Crear usuario de prueba
        const testUser = await User.create({
            name: 'Test User',
            email: 'test@example.com',
            password: 'Test1234', // Será hasheado automáticamente por el pre-save hook
            isActive: true,
        });

        console.log('✅ Usuario de prueba creado exitosamente');
        console.log('   Email: test@example.com');
        console.log('   Contraseña: Test1234');
        console.log('   ID: ' + testUser._id);

        await mongoose.disconnect();
        console.log('✅ Desconectado de MongoDB');
    } catch (error) {
        console.error('❌ Error al crear usuario de prueba:', error.message);
        process.exit(1);
    }
}

seedTestUser();
