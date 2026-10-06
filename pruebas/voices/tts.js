const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Texto recibido desde la consola
const texto = process.argv.slice(2).join(" ");

if (!texto) {
    console.log('Uso: node tts.js "Hola mundo"');
    process.exit(1);
}

// Esta carpeta es donde está ESTE archivo
const carpetaVoces = __dirname;

// Buscar automáticamente el modelo .onnx
const archivos = fs.readdirSync(carpetaVoces);

const modelo = archivos.find(
    archivo => archivo.toLowerCase().endsWith(".onnx")
);

if (!modelo) {
    console.error("❌ No encontré ningún modelo .onnx en:");
    console.error(carpetaVoces);
    process.exit(1);
}

const rutaModelo = path.join(carpetaVoces, modelo);

// El WAV se guarda en la carpeta principal del proyecto
const carpetaProyecto = path.dirname(carpetaVoces);
const salida = path.join(carpetaProyecto, "voz-piper.wav");

console.log("=================================");
console.log("       PIPER TTS");
console.log("=================================");
console.log("Modelo:", modelo);
console.log("Texto:", texto);
console.log("Salida:", salida);
console.log("");
console.log("Generando voz...");

const proceso = spawn("python", [
    "-m",
    "piper",
    "-m",
    rutaModelo,
    "--output_file",
    salida
]);

let stderr = "";

proceso.stdout.on("data", data => {
    process.stdout.write(data.toString());
});

proceso.stderr.on("data", data => {
    stderr += data.toString();
});

proceso.on("error", error => {
    console.error("");
    console.error("❌ No se pudo iniciar Piper.");
    console.error(error.message);
    process.exit(1);
});

proceso.stdin.write(texto);
proceso.stdin.end();

proceso.on("close", codigo => {
    if (codigo !== 0) {
        console.error("");
        console.error("❌ Piper terminó con error.");
        console.error("");
        console.error(stderr);
        process.exit(codigo);
    }

    if (!fs.existsSync(salida)) {
        console.error("");
        console.error("❌ Piper terminó pero no creó el archivo WAV.");
        process.exit(1);
    }

    console.log("");
    console.log("=================================");
    console.log("✅ VOZ GENERADA CORRECTAMENTE");
    console.log("=================================");
    console.log("");
    console.log("Archivo:");
    console.log(salida);
});