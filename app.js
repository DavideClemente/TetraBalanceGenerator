// app.js
// Contains all JavaScript logic for Tetra Balance

let scene, camera, renderer, currentPiece, pivot

/**
 * PIECE FORMAT
 * Each cube is [x, z, h]:
 *   x -> left/right on the table
 *   z -> forward/back on the table
 *   h -> height level (0 on table, 1 one block above, etc.)
 *
 * Top & bottom are ALWAYS open; only side faces are covered.
 * Internal side walls are added where cubes touch at the same height.
 */
const pieces = [
    // Classic flat tetrominoes (h=0)
    [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0]
    ], // I
    [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [2, 1, 0]
    ], // L
    [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [1, 1, 0]
    ], // T
    [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [2, 1, 0]
    ], // Z
    [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0]
    ], // O
    [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [1, 0, 1]
    ],
    [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 0, 1]
    ]
]

function init() {
    // Scene
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)

    // Camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    )
    camera.position.set(5, 5, 6)
    camera.lookAt(0, 0, 0)

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    document.getElementById('canvas-container').appendChild(renderer.domElement)

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.position.set(10, 10, 6)
    dir.castShadow = true
    dir.shadow.mapSize.width = 2048
    dir.shadow.mapSize.height = 2048
    scene.add(dir)

    // Ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshLambertMaterial({
            color: 0xfafafa,
            transparent: true,
            opacity: 0.85
        })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -2
    ground.receiveShadow = true
    scene.add(ground)

    generateNewPiece()
    animate()
}

// Build a single printed-style block (bars + optional side planes)
function createBlock(exposedFaces, material) {
    const blockGroup = new THREE.Group()

    const size = 1.0 // cube size
    const t = 0.05 // bar thickness
    const barMat = material
    const faceMat = new THREE.MeshLambertMaterial({
        color: material.color,
        side: THREE.DoubleSide
    })

    // Edge bars
    const horiz = new THREE.BoxGeometry(size, t, t)
    const depth = new THREE.BoxGeometry(t, t, size)
    const vert = new THREE.BoxGeometry(t, size, t)

    const addBar = (geom, x, y, z) => {
        const m = new THREE.Mesh(geom, barMat)
        m.position.set(x, y, z)
        m.castShadow = m.receiveShadow = true
        blockGroup.add(m)
    }

    // bottom edges
    addBar(horiz, 0, -size / 2, size / 2)
    addBar(horiz, 0, -size / 2, -size / 2)
    addBar(depth, size / 2, -size / 2, 0)
    addBar(depth, -size / 2, -size / 2, 0)

    // top edges
    addBar(horiz, 0, size / 2, size / 2)
    addBar(horiz, 0, size / 2, -size / 2)
    addBar(depth, size / 2, size / 2, 0)
    addBar(depth, -size / 2, size / 2, 0)

    // verticals
    addBar(vert, size / 2, 0, size / 2)
    addBar(vert, -size / 2, 0, size / 2)
    addBar(vert, size / 2, 0, -size / 2)
    addBar(vert, -size / 2, 0, -size / 2)

    // side faces only (front/back/left/right)
    const faceGeom = new THREE.PlaneGeometry(size, size)
    const EPS = 0.0015

    const addFace = (where) => {
        const p = new THREE.Mesh(faceGeom, faceMat)
        if (where === 'front') {
            p.position.z = size / 2 + EPS
        }
        if (where === 'back') {
            p.position.z = -size / 2 - EPS
            p.rotation.y = Math.PI
        }
        if (where === 'left') {
            p.position.x = -size / 2 - EPS
            p.rotation.y = Math.PI / 2
        }
        if (where === 'right') {
            p.position.x = size / 2 + EPS
            p.rotation.y = -Math.PI / 2
        }
        p.castShadow = p.receiveShadow = true
        blockGroup.add(p)
    }

    exposedFaces.forEach((f) => {
        if (f === 'front' || f === 'back' || f === 'left' || f === 'right')
            addFace(f)
    })

    return blockGroup
}

// Side-face exposure at the SAME height (no top/bottom)
function exposedFacesFor([x, z, h], occ3D) {
    const has = (a, b, c) => occ3D.has(`${a},${b},${c}`) // key(x,z,h)
    const faces = []
    if (!has(x, z + 1, h)) faces.push('front') // +z
    if (!has(x, z - 1, h)) faces.push('back') // -z
    if (!has(x - 1, z, h)) faces.push('left') // -x
    if (!has(x + 1, z, h)) faces.push('right') // +x
    return faces // top/bottom always open
}

// Internal side partitions between touching cubes (same height only)
function addInternalWalls(pieceCoords, group, colorMat) {
    const key = (x, z, h) => `${x},${z},${h}`
    const occ3D = new Set(pieceCoords.map(([x, z, h = 0]) => key(x, z, h)))

    const innerGeom = new THREE.PlaneGeometry(1.0, 1.0)
    const faceMat = new THREE.MeshLambertMaterial({
        color: colorMat.color,
        side: THREE.DoubleSide
    })

    for (const [x, z, h = 0] of pieceCoords) {
        // Wall between (x,z,h) and (x+1,z,h): plane parallel to YZ at x+0.5
        if (occ3D.has(key(x + 1, z, h))) {
            const p = new THREE.Mesh(innerGeom, faceMat)
            p.rotation.y = Math.PI / 2 // ±X
            p.position.set(x + 0.5, h, z)
            p.castShadow = p.receiveShadow = true
            group.add(p)
        }
        // Wall between (x,z,h) and (x,z+1,h): plane parallel to XY at z+0.5
        if (occ3D.has(key(x, z + 1, h))) {
            const p = new THREE.Mesh(innerGeom, faceMat)
            p.position.set(x, h, z + 0.5)
            p.castShadow = p.receiveShadow = true
            group.add(p)
        }
        // NOTE: No horizontal partitions between vertical neighbors (top/bottom stay open)
    }
}

function generateNewPiece() {
    if (currentPiece) scene.remove(currentPiece)
    currentPiece = new THREE.Group()

    const data = pieces[Math.floor(Math.random() * pieces.length)]

    // 3D occupancy keyed by (x,z,h)
    const occ3D = new Set(data.map(([x, z, h = 0]) => `${x},${z},${h}`))
    const material = new THREE.MeshLambertMaterial({ color: 0xe74c3c })

    for (const [x, z, h = 0] of data) {
        const faces = exposedFacesFor([x, z, h], occ3D) // sides only at this height
        const block = createBlock(faces, material)
        block.position.set(x, h, z) // place using height
        currentPiece.add(block)
    }

    // Internal side partitions
    addInternalWalls(data, currentPiece, material)

    // --- Center the piece and mount it under a pivot at origin ---
    const box = new THREE.Box3().setFromObject(currentPiece)
    const center = box.getCenter(new THREE.Vector3())

    // Move the whole piece so its center sits at (0,0,0)
    currentPiece.position.sub(center)

    // Create/replace pivot and attach the centered piece
    if (pivot) {
        scene.remove(pivot)
    }
    pivot = new THREE.Group()
    pivot.add(currentPiece)
    scene.add(pivot)
}

let resetVertical = false

// Pause button logic
let rotationPaused = false;
const pauseBtn = document.getElementById('pause-btn');
pauseBtn.addEventListener('click', function() {
    rotationPaused = !rotationPaused;
    pauseBtn.style.background = rotationPaused ? '#eee' : '#fff';

    if (rotationPaused) {
        // Change to play icon
        pauseBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle">
                <polygon points="4,3 14,9 4,15" fill="#333" />
            </svg>
        `;
        pauseBtn.title = "Play animation";
    } else {
        // Change back to pause icon
        pauseBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle">
                <rect x="3" y="3" width="4" height="12" rx="1.5" fill="#333" />
                <rect x="11" y="3" width="4" height="12" rx="1.5" fill="#333" />
            </svg>
        `;
        pauseBtn.title = "Pause rotation";
    }
});

function animate() {
    requestAnimationFrame(animate);
    // Only auto-spin when not dragging and not paused
    if (pivot && !isDragging && !rotationPaused) {
        // Smoothly reset vertical rotation after touch end
        if (resetVertical) {
            pivot.rotation.x += (0 - pivot.rotation.x) * 0.18;
            if (Math.abs(pivot.rotation.x) < 0.001) {
                pivot.rotation.x = 0;
                resetVertical = false;
            }
        }
        pivot.rotation.y += 0.005;
    }
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

window.addEventListener('load', init)
// --- Touch drag controls for mobile rotation ---
let isDragging = false
let lastX = 0
let lastY = 0
let dragDeltaY = 0

function onTouchStart(e) {
    isDragging = true
    lastX = e.touches[0].clientX
    lastY = e.touches[0].clientY
    dragDeltaY = pivot ? pivot.rotation.x : 0
}

function onTouchMove(e) {
    if (!isDragging || !pivot) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - lastX;
    const dy = y - lastY;
    // Horizontal drag: rotate Y, Vertical drag: rotate X
    pivot.rotation.y += dx * 0.01;
    pivot.rotation.x += dy * 0.01;
    // Remove clamp: allow full vertical rotation
    lastX = x;
    lastY = y;
}

function onTouchEnd() {
    isDragging = false
    resetVertical = true
}

const canvasContainer = document.getElementById('canvas-container')
canvasContainer.addEventListener('touchstart', onTouchStart, { passive: true })
canvasContainer.addEventListener('touchmove', onTouchMove, { passive: false })
canvasContainer.addEventListener('touchend', onTouchEnd, { passive: true })


// Handle "New Piece" button click
document.getElementById('new-piece-btn').addEventListener('click', generateNewPiece);