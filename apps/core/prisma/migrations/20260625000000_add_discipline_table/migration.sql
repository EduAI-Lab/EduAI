-- Issue 541: Workday course codes. Add the Discipline reference table (UBCO
-- subject codes / "units"), seed it from prisma/data/disciplines.csv, then make
-- courses.department a foreign key into it. Disciplines are INSERTed BEFORE the
-- FK constraint so `prisma migrate deploy` cannot fail validating existing rows.

-- CreateTable
CREATE TABLE IF NOT EXISTS "disciplines" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disciplines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "disciplines_code_key" ON "disciplines"("code");
CREATE INDEX IF NOT EXISTS "disciplines_name_idx" ON "disciplines"("name");

-- Seed the 105 Workday disciplines (idempotent). Must precede the FK below.
INSERT INTO "disciplines" ("id", "code", "name", "createdAt") VALUES
  ('cmnp272wr00051bww367oyhry', 'COSC', 'Computer Science', '2026-04-07 20:15:47.835'),
  ('cmnp272wv00061bwwyuj6n703', 'MATH', 'Mathematics', '2026-04-07 20:15:47.839'),
  ('cmnp272wz00071bwwrd3tmew9', 'STAT', 'Statistics', '2026-04-07 20:15:47.843'),
  ('cmnp272x300081bwwurj95c45', 'DATA', 'Data Science', '2026-04-07 20:15:47.847'),
  ('cmnp272x700091bwwgt0guwwt', 'ASTR', 'Astronomy', '2026-04-07 20:15:47.851'),
  ('cmnp272xb000a1bwwiayq8n0m', 'PHYS', 'Physics', '2026-04-07 20:15:47.855'),
  ('cmnp4alwf0005xfwwl5i9r9lx', 'AGRO', 'Agroecology', '2026-04-07 21:14:31.648'),
  ('cmnp4alwk0006xfwwanjsvi8d', 'AGSC', 'Agricultural Sciences', '2026-04-07 21:14:31.652'),
  ('cmnp4alwo0007xfww0suies45', 'ANTH', 'Anthropology', '2026-04-07 21:14:31.656'),
  ('cmnp4alwr0008xfwwiz27sbul', 'APPP', 'Applied Science Professional Platform', '2026-04-07 21:14:31.659'),
  ('cmnp4alww0009xfwwc9fhxtvb', 'APSC', 'Applied Science', '2026-04-07 21:14:31.664'),
  ('cmnp4alx0000axfww5dsnnfsp', 'ARCO', 'Arts Co-Op', '2026-04-07 21:14:31.668'),
  ('cmnp4alx4000bxfwwineyj9j0', 'ARTH', 'Art History and Visual Culture', '2026-04-07 21:14:31.672'),
  ('cmnp4alx8000cxfwwalejaw0z', 'ARTS', 'Arts', '2026-04-07 21:14:31.676'),
  ('cmnp4alxf000dxfwwd4cozuyu', 'BIOC', 'Biochemistry', '2026-04-07 21:14:31.683'),
  ('cmnp4alxj000exfwwrricgyfy', 'BIOL', 'Biology', '2026-04-07 21:14:31.687'),
  ('cmnp4alxn000fxfwwhiqxbz95', 'BTEC', 'Biotechnology', '2026-04-07 21:14:31.691'),
  ('cmnp4alxq000gxfwwtbc6rhxq', 'CCS', 'Creative and Critical Studies', '2026-04-07 21:14:31.694'),
  ('cmnp4alxu000hxfwwba8c8cb8', 'CHEM', 'Chemistry', '2026-04-07 21:14:31.698'),
  ('cmnp4alxx000ixfwwmc7a3de9', 'CHIN', 'Chinese', '2026-04-07 21:14:31.701'),
  ('cmnp4aly1000jxfwwnbhkm37b', 'CMPE', 'Computer Engineering', '2026-04-07 21:14:31.705'),
  ('cmnp4aly5000kxfww0w47oclu', 'COMM', 'Commerce', '2026-04-07 21:14:31.709'),
  ('cmnp4alyi000lxfwwc70e26j4', 'COOP', 'Cooperative Education', '2026-04-07 21:14:31.722'),
  ('cmnp4alyl000mxfwwx3agz5ea', 'CORH', 'Communications And Rhetoric', '2026-04-07 21:14:31.725'),
  ('cmnp4alys000nxfww9pf65luu', 'CRWR', 'Creative Writing', '2026-04-07 21:14:31.732'),
  ('cmnp4alyw000oxfwwgk9lfsdg', 'CULT', 'Cultural Studies', '2026-04-07 21:14:31.736'),
  ('cmnp4alyz000pxfwwoqzez9j6', 'CUST', 'Curriculum Studies', '2026-04-07 21:14:31.739'),
  ('cmnp4alz6000qxfww7r7w7ckf', 'DICE', 'Design, Innovation, Creativity, Entrepreneurship', '2026-04-07 21:14:31.746'),
  ('cmnp4alz9000rxfww8d2f5ldu', 'DIHU', 'Digital Humanities', '2026-04-07 21:14:31.749'),
  ('cmnp4alze000sxfwwrnkll7ne', 'DRAM', 'Drama', '2026-04-07 21:14:31.754'),
  ('cmnp4alzi000txfwwct45ppqm', 'EADM', 'Educational Administration', '2026-04-07 21:14:31.758'),
  ('cmnp4alzl000uxfwwhhor32c9', 'EAP', 'English for Academic Purposes', '2026-04-07 21:14:31.761'),
  ('cmnp4alzp000vxfwwuh8g8h87', 'ECED', 'Early Childhood Education', '2026-04-07 21:14:31.765'),
  ('cmnp4alzs000wxfwwizpu98xj', 'ECON', 'Economics', '2026-04-07 21:14:31.768'),
  ('cmnp4alzw000xxfwwe2avuyom', 'EDLL', 'Education Doctorate Leadership and Learning', '2026-04-07 21:14:31.772'),
  ('cmnp4alzz000yxfwwwlt5naeb', 'EDST', 'Educational Studies', '2026-04-07 21:14:31.775'),
  ('cmnp4am02000zxfwwmj8c5kxm', 'EDUC', 'Education', '2026-04-07 21:14:31.778'),
  ('cmnp4am060010xfww1kp7ptyz', 'EESC', 'Earth & Environmental Sciences', '2026-04-07 21:14:31.782'),
  ('cmnp4am090011xfwwtn0xte7j', 'ELEV', 'Elective', '2026-04-07 21:14:31.785'),
  ('cmnp4am0c0012xfwwayderwvd', 'ENGL', 'English', '2026-04-07 21:14:31.788'),
  ('cmnp4am0g0013xfww2fgipzrs', 'ENGR', 'Engineering', '2026-04-07 21:14:31.792'),
  ('cmnp4am0j0014xfww393qqoil', 'ENVI', 'Environmental Sciences', '2026-04-07 21:14:31.795'),
  ('cmnp4am0n0015xfww1d6sr4tz', 'EPSE', 'Educational Psychology and Special Education', '2026-04-07 21:14:31.799'),
  ('cmnp4am0q0016xfwwrxdpkjb1', 'ETEC', 'Educational Technology', '2026-04-07 21:14:31.802'),
  ('cmnp4am0u0017xfwwlfr3rstl', 'EXCH', 'Exchange Programs', '2026-04-07 21:14:31.806'),
  ('cmnp4am110018xfwwugh473ig', 'FDSY', 'Food Systems', '2026-04-07 21:14:31.813'),
  ('cmnp4am140019xfww8f68otox', 'FILM', 'Film', '2026-04-07 21:14:31.816'),
  ('cmnp4am17001axfwwta1lh8tk', 'FREN', 'French', '2026-04-07 21:14:31.819'),
  ('cmnp4am1b001bxfww9sjzky14', 'FWSC', 'Freshwater Science', '2026-04-07 21:14:31.823'),
  ('cmnp4am1f001cxfwwc1p03yf2', 'GEOG', 'Geography', '2026-04-07 21:14:31.827'),
  ('cmnp4am1i001dxfwwapurod5z', 'GEOP', 'Geophysics', '2026-04-07 21:14:31.830'),
  ('cmnp4am1l001exfwwcod6tedm', 'GERM', 'German', '2026-04-07 21:14:31.833'),
  ('cmnp4am1p001fxfwwkhcqjpo0', 'GERO', 'Gerontology', '2026-04-07 21:14:31.837'),
  ('cmnp4am1s001gxfwwzxb63x2l', 'GISC', 'Geospatial Information Science', '2026-04-07 21:14:31.840'),
  ('cmnp4am1w001hxfwwvpitk7ub', 'GREK', 'Greek', '2026-04-07 21:14:31.844'),
  ('cmnp4am1z001ixfww58vl43vi', 'GRTU', 'Registration for Graduate Tuition Instalment', '2026-04-07 21:14:31.847'),
  ('cmnp4am22001jxfwwlbuc1cvq', 'GWST', 'Gender, Women and Sexuality Studies', '2026-04-07 21:14:31.850'),
  ('cmnp4am26001kxfwwofd6dhj5', 'HEAL', 'Health Studies', '2026-04-07 21:14:31.854'),
  ('cmnp4am29001lxfwwesw7ghul', 'HEBR', 'Hebrew', '2026-04-07 21:14:31.857'),
  ('cmnp4am2c001mxfww29j11buw', 'HES', 'Health & Exercise Sciences', '2026-04-07 21:14:31.861'),
  ('cmnp4am2g001nxfwwnpsow5fm', 'HINT', 'Health-Interprofessional', '2026-04-07 21:14:31.864'),
  ('cmnp4am2j001oxfwwof4eo1l9', 'HIST', 'History', '2026-04-07 21:14:31.867'),
  ('cmnp4am2n001pxfww9n70gd3s', 'HMKN', 'Human Kinetics', '2026-04-07 21:14:31.871'),
  ('cmnp4am2q001qxfwwe21kpfxl', 'IGS', 'Interdisciplinary Graduate Studies', '2026-04-07 21:14:31.874'),
  ('cmnp4am2u001rxfwwp26fpv1p', 'IMTC', 'Immersive Technologies', '2026-04-07 21:14:31.878'),
  ('cmnp4am2x001sxfwwafn6kq14', 'INDG', 'Indigenous Studies', '2026-04-07 21:14:31.881'),
  ('cmnp4am31001txfww55s3kt39', 'INLG', 'Indigenous Language', '2026-04-07 21:14:31.885'),
  ('cmnp4am39001uxfwwj52cwiyv', 'JAPN', 'Japanese', '2026-04-07 21:14:31.893'),
  ('cmnp4am3d001vxfww1k2wdk9g', 'JPST', 'Japanese Studies', '2026-04-07 21:14:31.897'),
  ('cmnp4am3g001wxfwwx4ahhvs0', 'KORN', 'Korean', '2026-04-07 21:14:31.900'),
  ('cmnp4am3j001xxfww4dor32il', 'LANG', 'Languages', '2026-04-07 21:14:31.903'),
  ('cmnp4am3n001yxfwwlk6oo3jc', 'LATN', 'Latin', '2026-04-07 21:14:31.907'),
  ('cmnp4am3q001zxfww18kq65ns', 'LLED', 'Language and Literacy Education', '2026-04-07 21:14:31.910'),
  ('cmnp4am3u0020xfww3ogd4eju', 'MANF', 'Manufacturing Engineering', '2026-04-07 21:14:31.915'),
  ('cmnp4am430021xfwwh2tjfx0a', 'MDST', 'Media Studies', '2026-04-07 21:14:31.924'),
  ('cmnp4am480022xfwwzfb4b81c', 'MGCO', 'Management Co-Op', '2026-04-07 21:14:31.928'),
  ('cmnp4am4d0023xfwwt8qiguer', 'MGIT', 'Management Studies', '2026-04-07 21:14:31.933'),
  ('cmnp4am4i0024xfwwssffn29u', 'MGMT', 'Management', '2026-04-07 21:14:31.938'),
  ('cmnp4am4l0025xfwwucwcfelk', 'MUSC', 'Music', '2026-04-07 21:14:31.941'),
  ('cmnp4am4p0026xfww6p4knf8i', 'NLEK', 'Nle?kepmx Language', '2026-04-07 21:14:31.945'),
  ('cmnp4am4t0027xfwwo77bqla9', 'NRSG', 'Nursing', '2026-04-07 21:14:31.949'),
  ('cmnp4am4w0028xfwwdkkqzc5l', 'NSYL', 'Nsyilxcn', '2026-04-07 21:14:31.952'),
  ('cmnp4am4z0029xfwwsx4ni6kj', 'PDHC', 'Product Design for Human Comfort', '2026-04-07 21:14:31.955'),
  ('cmnp4am53002axfwwmttagdn5', 'PHIL', 'Philosophy', '2026-04-07 21:14:31.959'),
  ('cmnp4am5a002bxfwwawi7nlw4', 'POLI', 'Political Science', '2026-04-07 21:14:31.966'),
  ('cmnp4am5d002cxfwwbap7b99n', 'PSYC', 'Psychology', '2026-04-07 21:14:31.969'),
  ('cmnp4am5g002dxfwwrz27skfa', 'PSYO', 'Psychology', '2026-04-07 21:14:31.972'),
  ('cmnp4am5k002exfwwtp80aghg', 'SCCO', 'Science Co-Op', '2026-04-07 21:14:31.976'),
  ('cmnp4am5n002fxfwwp63rusu1', 'SCIE', 'Science', '2026-04-07 21:14:31.979'),
  ('cmnp4am5q002gxfwwaxtyfn6h', 'SECH', 'Social and Economic Change', '2026-04-07 21:14:31.982'),
  ('cmnp4am5u002hxfwwasstdf2p', 'SECW', 'Secwépemc', '2026-04-07 21:14:31.986'),
  ('cmnp4am5y002ixfww24b9moc2', 'SOCI', 'Sociology', '2026-04-07 21:14:31.990'),
  ('cmnp4am64002jxfww3lsgf5jk', 'SOCW', 'Social Work', '2026-04-07 21:14:31.996'),
  ('cmnp4am68002kxfwwh01fi2bf', 'SPAN', 'Spanish', '2026-04-07 21:14:32.000'),
  ('cmnp4am6f002lxfwwamcej2bo', 'STMC', 'St''át''imc Language', '2026-04-07 21:14:32.007'),
  ('cmnp4am6i002mxfwwu30tzhxp', 'SUPL', 'Supplemental', '2026-04-07 21:14:32.010'),
  ('cmnp4am6m002nxfwwsikkp82z', 'SUST', 'Sustainability', '2026-04-07 21:14:32.014'),
  ('cmnp4am6q002oxfwwdf9k8mwg', 'THTR', 'Theatre', '2026-04-07 21:14:32.018'),
  ('cmnp4am6t002pxfwwk0n1vaip', 'UGTU', 'Registration for Undergraduate Tuition Instalment', '2026-04-07 21:14:32.021'),
  ('cmnp4am6w002qxfww0fxvn6gl', 'VANT', 'Vantage College', '2026-04-07 21:14:32.024'),
  ('cmnp4am6z002rxfwwtxter8fa', 'VGRS', 'Visiting Graduate Research Students', '2026-04-07 21:14:32.027'),
  ('cmnp4am72002sxfwwu9qlcdut', 'VISA', 'Visual Arts', '2026-04-07 21:14:32.030'),
  ('cmnp4am76002txfwwndo09a19', 'VURS', 'Visiting Undergraduate Research Students', '2026-04-07 21:14:32.034'),
  ('cmnp4am79002uxfwwa43rmc2q', 'WMST', 'Women''S Studies', '2026-04-07 21:14:32.037'),
  ('cmnp4am7g002vxfwwryc7sg55', 'WRLD', 'World Literature', '2026-04-07 21:14:32.044')
ON CONFLICT ("code") DO NOTHING;

-- AddForeignKey: courses.department references disciplines.code. RESTRICT so an
-- in-use discipline cannot be deleted out from under a course.
DO $$ BEGIN
  ALTER TABLE "courses" ADD CONSTRAINT "courses_department_fkey" FOREIGN KEY ("department") REFERENCES "disciplines"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
