#!/data/data/com.termux/files/usr/bin/bash

set -e

BOT_DIR="JOA-KING"

cd "$(dirname "$0")"

echo "Instalando dependencias de $BOT_DIR..."
npm install

echo "Iniciando $BOT_DIR..."
npm start
