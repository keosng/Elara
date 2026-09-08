/*
 * ============================================================================
 *  走廊桌子模块
 * ============================================================================
 *  职责：造出走廊里靠墙摆放的木质桌子，并提供 hover / 上色 / 射线检测接口。
 *
 *  设计要点：
 *    - 几何体负责「体积和镂空的腿部间隙」，贴图负责「手绘质感」。
 *      两者分工，避免为了轮廓去做复杂的建模。
 *    - 每个桌子实例共享一组材质模板，但各自持有独立的 progress 对象，
 *      所以每张桌子可以独立地上色。
 *    - 对外只暴露 create / intersect / hover / update 四个方法。
 * ============================================================================
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js';

/**
 * 创建桌子工厂。
 * @param {(path: string, rx: number, ry: number, label: string) => THREE.Texture} loadTexture
 *        纹理加载函数，由主场景传入（复用主场景的 renderer 能力）
 * @returns {{ create: Function, intersect: Function, hover: Function, update: Function }}
 */
export function createTableFactory(loadTexture) {
  /* ------------------------------------------------------------------------
   * 1. 贴图准备
   *    桌子有 5 个部位，每个部位都有「线稿」和「上色」两张图
   * ------------------------------------------------------------------------ */

  /** 部位名 → [线稿贴图, 上色贴图] */
  const surfaces = new Map();
  for (const name of ['top', 'rim', 'front', 'side', 'leg']) {
    const maps = ['sketch', 'painted'].map((state) => {
      const texture = loadTexture(`./assets/table-${name}-${state}.png`, 1, 1, '桌子');
      // 桌子贴图是整张单图，不能平铺
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    });
    surfaces.set(name, maps);
  }

  /* ------------------------------------------------------------------------
   * 2. 辅助材质
   * ------------------------------------------------------------------------ */

  /** 桌腿与边条的深色描边，纯色即可 */
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: '#242321' });

  /**
   * 桌脚落地处的软阴影。
   * 用 Canvas 现画一个径向渐变贴在地面，比开真实阴影便宜得多。
   */
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d');
  const fade = shadowContext.createRadialGradient(32, 32, 4, 32, 32, 30);
  fade.addColorStop(0, 'rgba(30, 28, 25, 0.25)');
  fade.addColorStop(1, 'rgba(30, 28, 25, 0)');
  shadowContext.fillStyle = fade;
  shadowContext.fillRect(0, 0, 64, 64);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
  });

  /* ------------------------------------------------------------------------
   * 3. 实例注册表
   * ------------------------------------------------------------------------ */

  /** 所有可被射线命中的桌面网格（用于判断鼠标是否被桌子挡住） */
  const hitMeshes = new Set();
  /** 所有桌子实例的状态：{ group, progress } */
  const states = new Set();
  /** 当前被悬停的桌子状态 */
  let hovered = null;

  /* ------------------------------------------------------------------------
   * 4. 构造单张桌子
   * ------------------------------------------------------------------------ */

  /**
   * 造一张桌子。
   * @returns {THREE.Group}
   */
  function create() {
    const group = new THREE.Group();
    group.name = 'corridor-table';

    /**
     * 这张桌子的上色进度（0~1）。
     * 用对象包一层，是因为 ShaderMaterial 的 uniform 需要引用共享，
     * 直接传 number 的话所有材质拿到的都是快照，更新不了。
     */
    const progress = { value: 0 };
    const state = { group, progress };
    states.add(state);

    // 每个部位一套材质，共用同一个 progress
    const materials = new Map();
    for (const [name, maps] of surfaces) {
      materials.set(name, new THREE.ShaderMaterial({
        uniforms: {
          uSketch: { value: maps[0] },
          uPaint: { value: maps[1] },
          uProgress: progress,
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        },
        fog: true,
        vertexShader: `
          varying vec2 vUv;
          #include <fog_pars_vertex>
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: `
          uniform sampler2D uSketch;
          uniform sampler2D uPaint;
          uniform float uProgress;
          varying vec2 vUv;
          #include <fog_pars_fragment>
          void main() {
            gl_FragColor = mix(texture2D(uSketch, vUv), texture2D(uPaint, vUv), uProgress);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }
        `,
      }));
    }

    /**
     * 造一个长方体部件。
     *
     * TODO(性能)：每条边都会 new 一个 CylinderGeometry 作为描边，
     * 一张桌子约 7 个 part × 12 条边 ≈ 84 个独立几何体。
     * 5 张桌子就是 400+ 个 mesh，draw call 偏高。
     * 后续可考虑：用 LineSegments 替代（但线宽在部分平台不支持），
     * 或把这些描边合并成一个 BufferGeometry。
     *
     * @param {number} width  宽（X）
     * @param {number} height 高（Y）
     * @param {number} depth  深（Z）
     * @param {number} x 位置 X
     * @param {number} y 位置 Y
     * @param {number} z 位置 Z
     * @param {string[]} faceNames 六个面各用哪个部位的材质
     *        （顺序：+X, -X, +Y, -Y, +Z, -Z）
     * @param {number} lean 桌脚的倾斜量，0 = 不倾斜
     */
    function part(width, height, depth, x, y, z, faceNames, lean = 0) {
      const geometry = new THREE.BoxGeometry(width, height, depth);

      // 底部顶点收窄并偏移，做出手绘稿里那种略有歪斜的桌脚
      if (lean) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 1) {
          if (positions.getY(i) < 0) {
            positions.setX(i, positions.getX(i) * 0.8 + lean);
            positions.setZ(i, positions.getZ(i) * 0.8);
          }
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
      }

      const mesh = new THREE.Mesh(geometry, faceNames.map((name) => materials.get(name)));
      mesh.position.set(x, y, z);
      mesh.userData.tableState = state;
      group.add(mesh);
      hitMeshes.add(mesh);

      // 用细圆柱当描边：实心的，在移动端也可见（宽 GL 线在部分平台不支持）
      const edges = new THREE.EdgesGeometry(geometry);
      const positions = edges.attributes.position;
      for (let i = 0; i < positions.count; i += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, i);
        const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
        const direction = b.clone().sub(a);
        const stroke = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, direction.length(), 4), edgeMaterial,
        );
        stroke.position.copy(a).add(b).multiplyScalar(0.5);
        stroke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        mesh.add(stroke);
      }
      edges.dispose();
    }

    /*
     * 桌子结构（局部坐标：+Z 面向过道，X 平行于墙面）
     *   - 桌面
     *   - 前挡板 / 后挡板
     *   - 左右侧板 × 2
     *   - 四条桌腿（每条配一个地面软阴影）
     */
    part(2.7, 0.14, 1.12, 0, 2.13, 0, ['rim', 'rim', 'top', 'top', 'rim', 'rim']);
    part(2.33, 0.55, 0.10, 0, 1.785, 0.43, ['leg', 'leg', 'rim', 'rim', 'front', 'front']);
    part(2.33, 0.55, 0.10, 0, 1.785, -0.43, ['leg', 'leg', 'rim', 'rim', 'side', 'side']);
    for (const side of [-1, 1]) {
      part(0.12, 0.55, 0.8, side * 1.155, 1.785, 0,
        ['side', 'side', 'rim', 'rim', 'leg', 'leg']);
      for (const depth of [-1, 1]) {
        part(0.16, 2.045, 0.16, side * 1.155, 1.0345, depth * 0.43,
          ['leg', 'leg', 'top', 'top', 'leg', 'leg'], side * 0.026);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.36), shadowMaterial);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(side * 1.181, 0.006, depth * 0.43);
        group.add(shadow);
      }
    }

    /**
     * 段落被复用时调用：把桌子恢复成未上色状态。
     * 否则玩家前进后回头，会看到已经上过色的桌子。
     */
    group.userData.resetTableReveal = () => {
      progress.value = 0;
      if (hovered === state) hovered = null;
    };

    return group;
  }

  /* ------------------------------------------------------------------------
   * 5. 对外接口
   * ------------------------------------------------------------------------ */

  return {
    /** 造一张新桌子（供主场景的对象池调用） */
    create,

    /**
     * 射线检测：返回最近命中的桌面（没有则 undefined）。
     * @param {THREE.Raycaster} raycaster
     * @param {(obj: THREE.Object3D) => boolean} visible 可见性过滤
     */
    intersect(raycaster, visible) {
      return raycaster.intersectObjects([...hitMeshes].filter(visible), false)[0];
    },

    /** 设置当前悬停的桌子（传 null 取消） */
    hover(hit) {
      hovered = hit?.object.userData.tableState ?? null;
    },

    /**
     * 每帧推进上色进度。
     * 目标取 max(全局叙事进度 mood, 是否悬停)，
     * 所以全局上色后，桌子不会因为鼠标移开而退回线稿。
     * @param {number} delta 帧间隔（秒）
     * @param {number} mood 全局叙事进度（0~1）
     */
    update(delta, mood) {
      const step = Math.min(delta / 0.3, 1);
      states.forEach((state) => {
        const target = Math.max(mood, state === hovered && state.group.visible ? 1 : 0);
        state.progress.value = THREE.MathUtils.lerp(state.progress.value, target, step);
      });
    },
  };
}
