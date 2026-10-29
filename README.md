# Asteroid Evolution

This repository contains only the browser viewer. The program it runs is a continuum calculation for the long-term change of shape of a rubble-pile body under a prescribed spin history and, where the body orbits a primary, a tide. The bodies in the viewer are Ryugu, Itokawa, Phobos and Deimos. The solver, its tests and the notes that define the method are not published here. A scenario on the page is an exploration of that method under one choice of parameters. It is not a reconstruction of a real body, and it is not a forecast.

## What is computed

Two changes of shape are advanced on different clocks and are recorded separately.

The slow change is deep creep. The interior is treated as a quasi-static viscoplastic Stokes flow. Where the stress required for equilibrium reaches the local strength, the material is classified as yielded; the rest of the body is kept as a rigid core. A creep step, when one occurs, covers a long interval relative to a surface landslide.

The fast change is confined to a shallow layer and does not advance that slow clock. On the yield state left by the interior step, material may leave the surface and move across the rotating body, and a face that fails a repose test may be brought back toward that angle. The page labels this shallow part Mode C. A displacement of the surface is reported as deep creep only when the interior step produced it.

The spin history is an input, including a YORP trend where one is imposed. The calculation does not derive the torque, and it does not update the spin from the change of shape. Self-gravity is recomputed on the current triangulated shape. The acceleration passed to the interior solve and to the shallow layer is that gravitational acceleration, plus the centrifugal acceleration of the prescribed spin, plus a tidal field when a primary is present.

These choices set the limits of anything the page can show. The shallow motion is short on a geological clock, and the displacement in one step depends on the repose test and on the numerical step limits as well as on the material. The mass of each body is matched to a measured value where one exists. Where the interior density has not been measured, the profile used in a scenario is an assumption. Constants are taken from the literature where a published value exists; the remaining constants are modelling choices. A closer fit to a present-day shape would still leave the past under-determined.

## Where RTFP enters

RTFP (ray-traced finite part) is the gravity forward model and nothing else. It evaluates the Newtonian field of a triangulated body whose density is a uniform background plus smooth Cauchy kernels, so the density may vary in space.

At an evaluation point the field is split. The contribution of the density value at that point is the closed-form field of a uniform polyhedron, including the singular contact part of the potential. The remainder vanishes at the point and is integrated along rays through the body. A density with no spatial variation never uses those rays.

On each shape the evolution step asks RTFP for the mass, the centre of mass and the inertia of the chosen density; for the gravitational acceleration and its curvature at the centres of the surface faces; and for the same acceleration and curvature at the sample points of the interior problem. The spin and tidal terms are added to the acceleration outside RTFP. When the surface moves, the field is evaluated again. RTFP does not decide yield, does not move the mesh, and does not choose the spin.

For a uniform density, the closed-form part can be compared with an independent polyhedral formula. That comparison concerns only the uniform forward model. It does not test the creep step or the shallow layer.

## A possible use, and what is different here

Work on rubble-pile shape often uses discrete elements, or a continuum model whose gravity is spherical or of uniform density. The combination attempted here is narrower than either of those programmes. It keeps an irregular shape, a smooth density variation and a polyhedral field inside one loop, and it stores deep yield and shallow slope failure as separate contributions. For a stated spin history and a stated set of parameters, the loop can be used to ask whether the interior yields, whether the shallow layer moves, or whether little happens. Equatorial ridges, surface landslides and the long-term figure of a small body are the observations that make the question worth asking.

Two choices carry that question. One is the use of RTFP, so that the body force comes from the current polyhedron and from the chosen density rather than from a fixed spherical field. The other is the split between the slow interior step and the shallow step, so that a change of outline is not assigned to deep creep by default. Both are modelling choices. Neither is a result about a particular asteroid, and neither shows that this description should replace a discrete-element calculation, a measured gravity field, or an existing polyhedral method.

## The page

The viewer is at <https://tom-jim.github.io/astroid-evolution-web/>. It needs a desktop browser with WebGPU; desktop Chrome is the configuration in which it has been run. The first visit reloads once, which is what allows the calculation to use shared memory.

The panels select the body and the scenario and expose a few parameters. The right mouse button orbits the view, the left mouse button pans, and the wheel zooms. The space bar pauses the run. Changing a parameter can change both whether the interior yields and how the surface moves. The picture on the screen is the scenario just computed, not a measured history.
