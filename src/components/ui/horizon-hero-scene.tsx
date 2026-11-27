'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

type StarField = THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
type Mountain = THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
type Nebula = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
type Atmosphere = THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

type ThreeRefs = {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  composer: EffectComposer | null;
  bloomPass: UnrealBloomPass | null;
  stars: StarField[];
  nebula: Nebula | null;
  mountains: Mountain[];
  atmosphere: Atmosphere | null;
  animationId: number | null;
  locations: number[];
  targetCameraX?: number;
  targetCameraY?: number;
  targetCameraZ?: number;
};

const totalSections = 2;

gsap.registerPlugin(ScrollTrigger);

/**
 * Client-only visual layer. The server-rendered shell owns all copy, links and
 * progress markup; this component only enhances it with WebGL and GSAP.
 */
export function HeroScene({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollProgressRef = useRef<HTMLElement | null>(null);
  const smoothCameraPos = useRef({ x: 0, y: 30, z: 100 });
  const [isReady, setIsReady] = useState(false);

  const threeRefs = useRef<ThreeRefs>({
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    bloomPass: null,
    stars: [],
    nebula: null,
    mountains: [],
    atmosphere: null,
    animationId: null,
    locations: [],
  });

  const getProgressElements = useCallback(() => {
    const root = containerRef.current;
    return {
      progress: root?.querySelector<HTMLElement>('[data-hero-progress]') ?? null,
      fill: root?.querySelector<HTMLElement>('[data-hero-progress-fill]') ?? null,
      counter: root?.querySelector<HTMLElement>('[data-hero-section-counter]') ?? null,
    };
  }, [containerRef]);

  useEffect(() => {
    let isActive = true;

    const progress = getProgressElements().progress;
    if (progress) progress.style.visibility = 'visible';

    const disposeThree = () => {
      const refs = threeRefs.current;

      refs.bloomPass?.dispose();
      refs.composer?.dispose();
      refs.stars.forEach((starField) => {
        starField.geometry.dispose();
        starField.material.dispose();
      });
      refs.mountains.forEach((mountain) => {
        mountain.geometry.dispose();
        mountain.material.dispose();
      });
      refs.nebula?.geometry.dispose();
      refs.nebula?.material.dispose();
      refs.atmosphere?.geometry.dispose();
      refs.atmosphere?.material.dispose();
      refs.renderer?.dispose();

      threeRefs.current = {
        scene: null,
        camera: null,
        renderer: null,
        composer: null,
        bloomPass: null,
        stars: [],
        nebula: null,
        mountains: [],
        atmosphere: null,
        animationId: null,
        locations: [],
      };
    };

    const initThree = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const refs = threeRefs.current;
      refs.scene = new THREE.Scene();
      refs.scene.fog = new THREE.FogExp2(0x000000, 0.00025);

      refs.camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        2000,
      );
      refs.camera.position.z = 100;
      refs.camera.position.y = 20;

      refs.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      refs.renderer.setSize(window.innerWidth, window.innerHeight);
      refs.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      refs.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      refs.renderer.toneMappingExposure = 0.4;

      refs.composer = new EffectComposer(refs.renderer);
      refs.composer.addPass(new RenderPass(refs.scene, refs.camera));

      refs.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.45,
        0.3,
        0.9,
      );
      refs.composer.addPass(refs.bloomPass);

      createStarField();
      createNebula();
      createMountains();
      createAtmosphere();
      getLocation();
      animate();
      setIsReady(true);
    };

    const getLocation = () => {
      threeRefs.current.locations = threeRefs.current.mountains.map((mountain) => mountain.position.z);
    };

    const createStarField = () => {
      const refs = threeRefs.current;
      const starCount = 5000;

      for (let i = 0; i < 3; i++) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        for (let j = 0; j < starCount; j++) {
          const radius = 200 + Math.random() * 800;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(Math.random() * 2 - 1);

          positions[j * 3] = radius * Math.sin(phi) * Math.cos(theta);
          positions[j * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
          positions[j * 3 + 2] = radius * Math.cos(phi);

          const color = new THREE.Color();
          const colorChoice = Math.random();
          if (colorChoice < 0.7) {
            color.setHSL(0, 0, 0.8 + Math.random() * 0.2);
          } else if (colorChoice < 0.9) {
            color.setHSL(0.08, 0.5, 0.8);
          } else {
            color.setHSL(0.6, 0.5, 0.8);
          }

          colors[j * 3] = color.r;
          colors[j * 3 + 1] = color.g;
          colors[j * 3 + 2] = color.b;
          sizes[j] = Math.random() * 2 + 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            depth: { value: i },
          },
          vertexShader: `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            uniform float time;
            uniform float depth;

            void main() {
              vColor = color;
              vec3 pos = position;

              float angle = time * 0.05 * (1.0 - depth * 0.3);
              mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
              pos.xy = rot * pos.xy;

              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              gl_PointSize = size * (300.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            varying vec3 vColor;

            void main() {
              float dist = length(gl_PointCoord - vec2(0.5));
              if (dist > 0.5) discard;

              float opacity = 1.0 - smoothstep(0.0, 0.5, dist);
              gl_FragColor = vec4(vColor, opacity);
            }
          `,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });

        const stars = new THREE.Points(geometry, material);
        refs.scene!.add(stars);
        refs.stars.push(stars);
      }
    };

    const createNebula = () => {
      const refs = threeRefs.current;

      const geometry = new THREE.PlaneGeometry(8000, 4000, 100, 100);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          color1: { value: new THREE.Color(0x0033ff) },
          color2: { value: new THREE.Color(0xff0066) },
          opacity: { value: 0.2 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying float vElevation;
          uniform float time;

          void main() {
            vUv = uv;
            vec3 pos = position;

            float elevation = sin(pos.x * 0.01 + time) * cos(pos.y * 0.01 + time) * 20.0;
            pos.z += elevation;
            vElevation = elevation;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 color1;
          uniform vec3 color2;
          uniform float opacity;
          uniform float time;
          varying vec2 vUv;
          varying float vElevation;

          void main() {
            float mixFactor = sin(vUv.x * 10.0 + time) * cos(vUv.y * 10.0 + time);
            vec3 color = mix(color1, color2, mixFactor * 0.5 + 0.5);

            float alpha = opacity * (1.0 - length(vUv - 0.5) * 2.0);
            alpha *= 1.0 + vElevation * 0.01;

            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const nebula = new THREE.Mesh(geometry, material);
      nebula.position.z = -1050;
      nebula.rotation.x = 0;
      refs.scene!.add(nebula);
      refs.nebula = nebula;
    };

    const createMountains = () => {
      const refs = threeRefs.current;
      const layers = [
        { distance: -50, height: 60, color: 0x1a1a2e, opacity: 1 },
        { distance: -100, height: 80, color: 0x16213e, opacity: 0.8 },
        { distance: -150, height: 100, color: 0x0f3460, opacity: 0.6 },
        { distance: -200, height: 120, color: 0x0a4668, opacity: 0.4 },
      ];

      layers.forEach((layer, index) => {
        const points = [];
        const segments = 50;

        for (let i = 0; i <= segments; i++) {
          const x = (i / segments - 0.5) * 1000;
          const y = Math.sin(i * 0.1) * layer.height
            + Math.sin(i * 0.05) * layer.height * 0.5
            + Math.random() * layer.height * 0.2 - 100;
          points.push(new THREE.Vector2(x, y));
        }

        points.push(new THREE.Vector2(5000, -300));
        points.push(new THREE.Vector2(-5000, -300));

        const geometry = new THREE.ShapeGeometry(new THREE.Shape(points));
        const material = new THREE.MeshBasicMaterial({
          color: layer.color,
          transparent: true,
          opacity: layer.opacity,
          side: THREE.DoubleSide,
        });

        const mountain = new THREE.Mesh(geometry, material);
        mountain.position.z = layer.distance;
        mountain.position.y = layer.distance;
        mountain.userData = { baseZ: layer.distance, index };
        refs.scene!.add(mountain);
        refs.mountains.push(mountain);
      });
    };

    const createAtmosphere = () => {
      const refs = threeRefs.current;

      const geometry = new THREE.SphereGeometry(600, 32, 32);
      const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          uniform float time;

          void main() {
            float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
            vec3 atmosphere = vec3(0.3, 0.6, 1.0) * intensity;

            float pulse = sin(time * 2.0) * 0.1 + 0.9;
            atmosphere *= pulse;

            gl_FragColor = vec4(atmosphere, intensity * 0.15);
          }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
      });

      const atmosphere = new THREE.Mesh(geometry, material);
      refs.scene!.add(atmosphere);
      refs.atmosphere = atmosphere;
    };

    const animate = () => {
      const refs = threeRefs.current;
      if (!isActive) return;

      refs.animationId = requestAnimationFrame(animate);
      const time = Date.now() * 0.001;

      refs.stars.forEach((starField) => {
        if (starField.material.uniforms) starField.material.uniforms.time.value = time;
      });

      if (refs.nebula?.material.uniforms) {
        refs.nebula.material.uniforms.time.value = time * 0.5;
      }

      if (refs.camera && refs.targetCameraX !== undefined) {
        const smoothingFactor = 0.05;
        smoothCameraPos.current.x += (refs.targetCameraX - smoothCameraPos.current.x) * smoothingFactor;
        smoothCameraPos.current.y += ((refs.targetCameraY ?? smoothCameraPos.current.y) - smoothCameraPos.current.y) * smoothingFactor;
        smoothCameraPos.current.z += ((refs.targetCameraZ ?? smoothCameraPos.current.z) - smoothCameraPos.current.z) * smoothingFactor;

        refs.camera.position.x = smoothCameraPos.current.x + Math.sin(time * 0.1) * 2;
        refs.camera.position.y = smoothCameraPos.current.y + Math.cos(time * 0.15);
        refs.camera.position.z = smoothCameraPos.current.z;
        refs.camera.lookAt(0, 10, -600);
      }

      refs.mountains.forEach((mountain, index) => {
        const parallaxFactor = 1 + index * 0.5;
        mountain.position.x = Math.sin(time * 0.1) * 2 * parallaxFactor;
        mountain.position.y = 50 + Math.cos(time * 0.15) * parallaxFactor;
      });

      refs.composer?.render();
    };

    const handleResize = () => {
      const refs = threeRefs.current;
      if (!refs.camera || !refs.renderer || !refs.composer) return;

      refs.camera.aspect = window.innerWidth / window.innerHeight;
      refs.camera.updateProjectionMatrix();
      refs.renderer.setSize(window.innerWidth, window.innerHeight);
      refs.composer.setSize(window.innerWidth, window.innerHeight);
    };

    try {
      initThree();
    } catch {
      // WebGL can be unavailable (browser policy, blocked GPU). The static
      // shell and CSS fallback remain visible instead of leaving a blank hero.
      disposeThree();
    }

    window.addEventListener('resize', handleResize);
    scrollProgressRef.current = getProgressElements().progress;

    return () => {
      isActive = false;
      window.removeEventListener('resize', handleResize);
      if (threeRefs.current.animationId !== null) {
        cancelAnimationFrame(threeRefs.current.animationId);
      }
      scrollProgressRef.current = null;
      disposeThree();
    };
  }, [containerRef, getProgressElements]);

  useEffect(() => {
    if (!isReady) return;

    const context = gsap.context(() => {
      if (scrollProgressRef.current) {
        gsap.set(scrollProgressRef.current, { visibility: 'visible' });
        gsap.from(scrollProgressRef.current, {
          opacity: 0,
          y: 50,
          duration: 1,
          ease: 'power2.out',
        });
      }
    }, containerRef);

    return () => context.revert();
  }, [containerRef, isReady]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const maxScroll = documentHeight - windowHeight;
      const progress = maxScroll > 0 ? Math.min(scrollY / maxScroll, 1) : 0;
      const sectionPosition = progress * totalSections;
      const activeSection = Math.min(Math.floor(sectionPosition), totalSections);
      const { fill, counter } = getProgressElements();

      if (fill) fill.style.width = `${progress * 100}%`;
      if (counter) {
        counter.textContent = `${String(activeSection).padStart(2, '0')} / ${String(totalSections).padStart(2, '0')}`;
      }

      const refs = threeRefs.current;
      const sectionProgress = sectionPosition % 1;
      const cameraPositions = [
        { x: 0, y: 30, z: 300 },
        { x: 0, y: 40, z: -50 },
        { x: 0, y: 50, z: -700 },
      ];
      const currentSection = Math.min(Math.floor(sectionPosition), totalSections);
      const currentPos = cameraPositions[currentSection] ?? cameraPositions[0];
      const nextPos = cameraPositions[currentSection + 1] ?? currentPos;

      refs.targetCameraX = currentPos.x + (nextPos.x - currentPos.x) * sectionProgress;
      refs.targetCameraY = currentPos.y + (nextPos.y - currentPos.y) * sectionProgress;
      refs.targetCameraZ = currentPos.z + (nextPos.z - currentPos.z) * sectionProgress;

      refs.mountains.forEach((mountain, index) => {
        const speed = 1 + index * 0.9;
        const targetZ = mountain.userData.baseZ + scrollY * speed * 0.5;
        if (refs.nebula) refs.nebula.position.z = (targetZ + progress * speed * 0.01) - 100;

        mountain.userData.targetZ = targetZ;
        mountain.position.z = progress > 0.7 ? 600000 : (refs.locations[index] ?? mountain.userData.baseZ);
      });

      if (refs.nebula && refs.mountains[3]) {
        refs.nebula.position.z = refs.mountains[3].position.z;
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [containerRef, getProgressElements]);

  return (
    <canvas
      ref={canvasRef}
      className="hero-canvas hero-canvas-live"
      data-ready={isReady ? 'true' : 'false'}
      aria-hidden="true"
    />
  );
}
