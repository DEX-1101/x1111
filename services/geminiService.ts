import { CollageLayout, ImageItem } from "../types";

export const detectFaceCenters = async (images: ImageItem[], onProgress?: (msg: string) => void): Promise<{ index: number, x: number, y: number }[]> => {
    if (onProgress) onProgress("Setting focus points...");
    // Simulate a small delay
    await new Promise(resolve => setTimeout(resolve, 300));
    return images.map((_, i) => ({ index: i, x: 50, y: 50 }));
}

type Point = { x: number, y: number };
type Poly = Point[];

function getCentroid(poly: Poly): Point {
    let cx = 0, cy = 0;
    for (let p of poly) {
        cx += p.x;
        cy += p.y;
    }
    return { x: cx / poly.length, y: cy / poly.length };
}

function splitPolygon(poly: Poly, isVertical: boolean): { poly1: Poly, poly2: Poly } {
    let minX = Math.min(...poly.map(p => p.x));
    let maxX = Math.max(...poly.map(p => p.x));
    let minY = Math.min(...poly.map(p => p.y));
    let maxY = Math.max(...poly.map(p => p.y));

    // Pick a point near the center of the bounding box
    let cx = minX + (maxX - minX) * (0.4 + Math.random() * 0.2);
    let cy = minY + (maxY - minY) * (0.4 + Math.random() * 0.2);

    // Random angle slightly skewed from pure vertical/horizontal
    // isVertical means we split left/right, so the line is mostly vertical (angle ~ pi/2)
    let angle = isVertical 
        ? (Math.PI / 2) + (Math.random() * 0.4 - 0.2) 
        : (Math.random() * 0.4 - 0.2);

    let dx = Math.cos(angle);
    let dy = Math.sin(angle);

    const dist = (p: Point) => (p.x - cx) * dy - (p.y - cy) * dx;

    let poly1: Poly = [];
    let poly2: Poly = [];

    for (let i = 0; i < poly.length; i++) {
        let p1 = poly[i];
        let p2 = poly[(i + 1) % poly.length];

        let d1 = dist(p1);
        let d2 = dist(p2);

        if (d1 > 0) {
            poly1.push(p1);
        } else if (d1 < 0) {
            poly2.push(p1);
        } else {
            // d1 == 0, point is exactly on the line
            poly1.push(p1);
            poly2.push(p1);
        }

        if (d1 * d2 < 0) {
            let t = d1 / (d1 - d2);
            let ix = p1.x + t * (p2.x - p1.x);
            let iy = p1.y + t * (p2.y - p1.y);
            let ip = { x: ix, y: iy };
            poly1.push(ip);
            poly2.push(ip);
        }
    }

    // Fallback if split fails (e.g. line doesn't intersect properly due to precision)
    if (poly1.length < 3 || poly2.length < 3) {
        poly1 = [];
        poly2 = [];
        let midX = minX + (maxX - minX) / 2;
        let midY = minY + (maxY - minY) / 2;
        for (let i = 0; i < poly.length; i++) {
            let p1 = poly[i];
            let p2 = poly[(i + 1) % poly.length];
            let d1 = isVertical ? p1.x - midX : p1.y - midY;
            let d2 = isVertical ? p2.x - midX : p2.y - midY;
            
            if (d1 > 0) {
                poly1.push(p1);
            } else if (d1 < 0) {
                poly2.push(p1);
            } else {
                poly1.push(p1);
                poly2.push(p1);
            }
            
            if (d1 * d2 < 0) {
                let t = d1 / (d1 - d2);
                let ix = isVertical ? midX : p1.x + t * (p2.x - p1.x);
                let iy = isVertical ? p1.y + t * (p2.y - p1.y) : midY;
                let ip = { x: ix, y: iy };
                poly1.push(ip);
                poly2.push(ip);
            }
        }
    }

    return { poly1, poly2 };
}

function fixTJunctions(regions: Poly[]) {
    const eps = 0.1; // 0.1% tolerance
    
    // Collect all unique vertices
    const vertices: Point[] = [];
    for (const poly of regions) {
        for (const p of poly) {
            if (!vertices.some(v => Math.abs(v.x - p.x) < eps && Math.abs(v.y - p.y) < eps)) {
                vertices.push(p);
            }
        }
    }

    // For each polygon, check each edge against all vertices
    for (let i = 0; i < regions.length; i++) {
        let poly = regions[i];
        let newPoly: Poly = [];
        
        for (let j = 0; j < poly.length; j++) {
            let p1 = poly[j];
            let p2 = poly[(j + 1) % poly.length];
            newPoly.push(p1);
            
            // Find all vertices that lie on the segment p1-p2
            let pointsOnEdge: Point[] = [];
            for (const v of vertices) {
                if ((Math.abs(v.x - p1.x) < eps && Math.abs(v.y - p1.y) < eps) ||
                    (Math.abs(v.x - p2.x) < eps && Math.abs(v.y - p2.y) < eps)) {
                    continue;
                }
                
                let l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
                if (l2 === 0) continue;
                
                let t = ((v.x - p1.x) * (p2.x - p1.x) + (v.y - p1.y) * (p2.y - p1.y)) / l2;
                
                if (t > eps/100 && t < 1 - eps/100) {
                    let projX = p1.x + t * (p2.x - p1.x);
                    let projY = p1.y + t * (p2.y - p1.y);
                    
                    let dist2 = (v.x - projX) ** 2 + (v.y - projY) ** 2;
                    
                    if (dist2 < eps * eps) {
                        pointsOnEdge.push(v);
                    }
                }
            }
            
            // Sort pointsOnEdge by distance from p1
            pointsOnEdge.sort((a, b) => {
                let distA = (a.x - p1.x) ** 2 + (a.y - p1.y) ** 2;
                let distB = (b.x - p1.x) ** 2 + (b.y - p1.y) ** 2;
                return distA - distB;
            });
            
            newPoly.push(...pointsOnEdge);
        }
        regions[i] = newPoly;
    }
}

export const generateCollageLayout = async (imageCount: number, aspectRatio: string, onProgress?: (msg: string) => void): Promise<CollageLayout> => {
    if (onProgress) onProgress("Generating layout...");
    await new Promise(resolve => setTimeout(resolve, 500));

    let regions: Poly[] = [
        [{x:0, y:0}, {x:100, y:0}, {x:100, y:100}, {x:0, y:100}]
    ];

    for (let i = 1; i < imageCount; i++) {
        // Find the largest region by bounding box area to split
        let largestIdx = 0;
        let maxArea = 0;
        for (let j = 0; j < regions.length; j++) {
            let poly = regions[j];
            let minX = Math.min(...poly.map(p => p.x));
            let maxX = Math.max(...poly.map(p => p.x));
            let minY = Math.min(...poly.map(p => p.y));
            let maxY = Math.max(...poly.map(p => p.y));
            let area = (maxX - minX) * (maxY - minY);
            if (area > maxArea) {
                maxArea = area;
                largestIdx = j;
            }
        }

        let poly = regions[largestIdx];
        
        let minX = Math.min(...poly.map(p => p.x));
        let maxX = Math.max(...poly.map(p => p.x));
        let minY = Math.min(...poly.map(p => p.y));
        let maxY = Math.max(...poly.map(p => p.y));
        
        let isVertical = (maxX - minX) > (maxY - minY);

        let { poly1, poly2 } = splitPolygon(poly, isVertical);

        regions.splice(largestIdx, 1);
        regions.push(poly1);
        regions.push(poly2);
    }

    fixTJunctions(regions);

    const layoutRegions = regions.map((poly, idx) => {
        const clipPath = `polygon(${poly.map(p => `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`).join(', ')})`;
        const centroid = getCentroid(poly);
        return {
            id: idx + 1,
            clipPath,
            labelX: `${centroid.x.toFixed(2)}%`,
            labelY: `${centroid.y.toFixed(2)}%`
        };
    });

    return {
        regions: layoutRegions,
        borderColor: "#000000",
        borderWidth: "4px"
    };
};

export const generateBackgroundTexture = async (onProgress?: (msg: string) => void): Promise<string | null> => {
    if (onProgress) onProgress("Applying background...");
    await new Promise(resolve => setTimeout(resolve, 300));
    return null;
};
