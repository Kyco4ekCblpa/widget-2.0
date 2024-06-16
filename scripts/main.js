document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("canvas");
    const gl = canvas.getContext("webgl");

    canvas.width = 300;
    canvas.height = 150;

    const fontWeight = 'Medium';

    // Колір рядка з ціною
    let textColor1 = {
        r: 96,
        g: 160,
        b: 106
    };

    // Колір рядка з назвою монети
    const textColor2 = {
        r: 255,
        g: 255,
        b: 255
    };

    // Колір лінії
    const lineColor = {
        r: 214,
        g: 39,
        b: 82
    };

    // Колір заливки під графіком
    const fillColor = {
        r: 214,
        g: 39,
        b: 82,
        a: 0.8 // Можна гратися з альфа-каналом для більшої початкової насиченості прям тут
    };

    let text1 = "";
    const text2 = "binance / BTCUSDT";
    const scale1 = 0.5;
    const scale2 = 0.3;

    const coin = "BTCUSDT";

    let fontData;
    let fontImage;
    let fontTexture;
    let textProgram;
    let positionBuffer;
    let uvBuffer;
    let graphProgram;
    let fillProgram;

    let priceHistory = [];
    const maxPriceHistoryLength = 1000;

    // Завантаження даних шрифта та текстури
    fetch(`../FontMSDF/Roboto-${fontWeight}/Roboto-${fontWeight}.json`)
        .then(response => response.json())
        .then(data => {
            fontData = data;
            loadFontTextureAndStart();
        });

    function loadFontTextureAndStart() {
        fontTexture = gl.createTexture();
        fontImage = new Image();
        fontImage.onload = function () {
            gl.bindTexture(gl.TEXTURE_2D, fontTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fontImage);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
            initShadersAndBuffers();
            animate();
        };
        fontImage.src = `../FontMSDF/Roboto-${fontWeight}/Roboto-${fontWeight}.png`;
    }

    function initShadersAndBuffers() {
        const vertexShaderSource = `
            attribute vec2 position;
            varying vec2 vPosition;

            void main() {
                vPosition = position;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 vPosition;
            uniform vec4 color;

            void main() {
                gl_FragColor = color;
            }
        `;

        const fillFragmentShaderSource = `
            precision mediump float;
            varying vec2 vPosition;
            uniform vec4 color;

            void main() {
                gl_FragColor = vec4(color.rgb, color.a * (vPosition.y + 1.0));
            }
        `;

        const textVertexShaderSource = `
            precision mediump float;
            attribute vec2 position;
            attribute vec2 uv;
            varying vec2 vUv;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                vUv = uv;
            }
        `;

        const textFragmentShaderSource = `
            precision highp float;
            uniform vec3 color;
            uniform sampler2D map;
            varying vec2 vUv;
            float median(float r, float g, float b) {
                return max(min(r, g), min(max(r, g), b));
            }
            void main() {
                vec4 texColor = texture2D(map, vUv);
                float sigDist = median(texColor.r, texColor.g, texColor.b) - 0.5;
                float alpha = smoothstep(0.0001, 0.1, sigDist);
                gl_FragColor = vec4(color, alpha);
                if (gl_FragColor.a < 0.0001) discard;
            }
        `;

        function createShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Помилка компіляції шейдера:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        function createProgram(gl, vertexShader, fragmentShader) {
            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('Помилка лінкування програми:', gl.getProgramInfoLog(program));
                return null;
            }
            return program;
        }

        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        const fillFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fillFragmentShaderSource);

        graphProgram = createProgram(gl, vertexShader, fragmentShader);
        fillProgram = createProgram(gl, vertexShader, fillFragmentShader);

        const textVertexShader = createShader(gl, gl.VERTEX_SHADER, textVertexShaderSource);
        const textFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, textFragmentShaderSource);
        textProgram = createProgram(gl, textVertexShader, textFragmentShader);

        positionBuffer = gl.createBuffer();
        uvBuffer = gl.createBuffer();
    }

    function animate() {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        renderText(text1, 0.75, textColor1, scale1);
        renderText(text2, 0.40, textColor2, scale2);

        renderGraph();
        requestAnimationFrame(animate);
    }

    function renderGraph() {
        const points = [];
        const graphHeight = 0.5;
        const yOffset = -0.8;

        const len = priceHistory.length;
        const startIndex = Math.max(0, len - 50);
        const subPriceHistory = priceHistory.slice(startIndex);
        const minValue = Math.min(...subPriceHistory);
        const maxValue = Math.max(...subPriceHistory);
        const valueRange = maxValue - minValue || 1;

        for (let i = 0; i < subPriceHistory.length; i++) {
            const x = (i / 49) * 2 - 1;
            const y = ((subPriceHistory[i] - minValue) / valueRange) * graphHeight + yOffset;
            points.push(x, y);
        }

        // Рендер заливки області під графіком
        gl.useProgram(fillProgram);
        const fillColorLocation = gl.getUniformLocation(fillProgram, 'color');
        gl.uniform4f(fillColorLocation, fillColor.r / 255, fillColor.g / 255, fillColor.b / 255, fillColor.a);

        const fillPoints = [];
        for (let i = 0; i < points.length; i += 2) {
            fillPoints.push(points[i], points[i + 1]);
            fillPoints.push(points[i], -1); // нижня межа
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fillPoints), gl.STATIC_DRAW);
        const positionLocation = gl.getAttribLocation(fillProgram, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, fillPoints.length / 2);

        // Рендер лінії графіку
        gl.useProgram(graphProgram);
        const lineColorLocation = gl.getUniformLocation(graphProgram, 'color');
        gl.uniform4f(lineColorLocation, lineColor.r / 255, lineColor.g / 255, lineColor.b / 255, 1.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);


        // Задаємо товщину лінії (не працює, бо максимальна підтримувана товщина "1", 
        // вичитав, що за необхідності можна погратися з рендерингом лініх за топомогою TRIANGLES)
        gl.lineWidth(2); 
        gl.drawArrays(gl.LINE_STRIP, 0, points.length / 2);
    }

    function renderText(text, yCoord, color, scale) {
        gl.useProgram(textProgram);

        const colorLocation = gl.getUniformLocation(textProgram, 'color');
        const mapUniformLocation = gl.getUniformLocation(textProgram, 'map');
        const positionAttributeLocation = gl.getAttribLocation(textProgram, 'position');
        const uvAttributeLocation = gl.getAttribLocation(textProgram, 'uv');

        gl.uniform3f(colorLocation, color.r / 255, color.g / 255, color.b / 255);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fontTexture);
        gl.uniform1i(mapUniformLocation, 0);

        gl.enableVertexAttribArray(positionAttributeLocation);
        gl.enableVertexAttribArray(uvAttributeLocation);

        let textWidth = 0;
        for (const char of text) {
            const glyphInfo = fontData.chars.find(glyph => glyph.id === char.charCodeAt(0));
            if (glyphInfo) {
                textWidth += (glyphInfo.xadvance * scale) / canvas.width;
            }
        }

        let normalizedX = -textWidth / 2;
        let normalizedY = yCoord;

        for (const char of text) {
            const glyphInfo = fontData.chars.find(glyph => glyph.id === char.charCodeAt(0));
            if (glyphInfo) {
                const u = glyphInfo.x / fontImage.width;
                const v = glyphInfo.y / fontImage.height;
                const u2 = (glyphInfo.x + glyphInfo.width) / fontImage.width;
                const v2 = (glyphInfo.y + glyphInfo.height) / fontImage.height;

                const normalizedOffsetY = (glyphInfo.yoffset * scale) / canvas.height;

                const positions = [
                    normalizedX, normalizedY - normalizedOffsetY,
                    normalizedX + ((glyphInfo.width * scale) / canvas.width), normalizedY - normalizedOffsetY,
                    normalizedX + ((glyphInfo.width * scale) / canvas.width), normalizedY - ((glyphInfo.height * scale) / canvas.height) - normalizedOffsetY,
                    normalizedX, normalizedY - ((glyphInfo.height * scale) / canvas.height) - normalizedOffsetY
                ];

                const texCoords = [
                    u, v,
                    u2, v,
                    u2, v2,
                    u, v2
                ];

                gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
                gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
                gl.vertexAttribPointer(uvAttributeLocation, 2, gl.FLOAT, false, 0, 0);

                gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

                normalizedX += (glyphInfo.xadvance * scale) / canvas.width;
            }
        }
    }

    function fetchPriceAndUpdateHistory() {
        fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${coin}`)
            .then(response => response.json())
            .then(data => {
                const price = parseFloat(data.price);


                // Поки обдумую логіку зміни кольору тексту з ціною в залежності від зміни ціни
                // + в подальшому додається стрілкочка "вниз"/"вверх" 

                // if (price < priceHistory[priceHistory.length - 1]) {
                //     textColor1.r = 214;
                //     textColor1.g = 39;
                //     textColor1.b = 82;
                // } else if (price > priceHistory[priceHistory.length - 1]) {
                //     textColor1.r = 96;
                //     textColor1.g = 160;
                //     textColor1.b = 106;
                // } else {
                //     textColor1.r = 255;
                //     textColor1.g = 255;
                //     textColor1.b = 255;
                // }

                priceHistory.push(price);
                if (priceHistory.length > maxPriceHistoryLength) {
                    priceHistory.shift();
                }
                text1 = `$ ${price.toFixed(2)}`;

                if (!animationStartTime) {
                    animationStartTime = performance.now();
                    requestAnimationFrame(animate);
                }
            })
            .catch(error => console.error('Fetch error:', error));
    }

    setInterval(fetchPriceAndUpdateHistory, 300);
    fetchPriceAndUpdateHistory();
});