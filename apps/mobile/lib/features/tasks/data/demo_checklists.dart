import '../domain/models/checklist_item.dart';
import '../domain/models/task_item.dart';

/// Sample checklists for `DEMO_MODE=true` builds, chosen by the task's
/// category. Real work orders load their checklist from the qc service.
class DemoChecklists {
  DemoChecklists._();

  static List<ChecklistItem> forTask(TaskItem task) {
    final cat = task.category.toLowerCase();
    final title = task.title.toLowerCase();
    String prefix;
    List<({String title, String guidance})> items;

    if (cat.contains('civil') ||
        title.contains('civil') ||
        title.contains('foundation') ||
        title.contains('mount') ||
        title.contains('fencing')) {
      prefix = 'CIV';
      items = const [
        (
          title: 'Pre-work structural survey & boundary clearance',
          guidance: 'Verify 360-degree boundary clearance and ground stability before works.',
        ),
        (
          title: 'Excavation depth & rebar tie wire tensile check',
          guidance: 'Inspect trench depth against structural drawings and verify rebar tying.',
        ),
        (
          title: 'Foundation level & mounting torque verification',
          guidance: 'Verify base plate horizontal leveling and torque anchor bolts to spec.',
        ),
        (
          title: 'Perimeter fencing & site safety clearance',
          guidance: 'Inspect perimeter grounding, safety hazard signage, and gate locking.',
        ),
        (
          title: 'Structural finish & foundation integrity inspection',
          guidance: 'Photograph cured concrete finish, slope drainage, and cable entry sleeves.',
        ),
      ];
    } else if (cat.contains('rf') ||
        cat.contains('telecom') ||
        title.contains('antenna') ||
        title.contains('mimo')) {
      prefix = 'RF';
      items = const [
        (
          title: 'Tower climb harness & PPE safety inspection',
          guidance: 'Verify 100% tie-off harness, helmet, double lanyard, and fall arrestor.',
        ),
        (
          title: 'Massive MIMO / Sector bracket torque alignment',
          guidance: 'Tighten mechanical brackets to manufacturer torque specs using torque wrench.',
        ),
        (
          title: 'Azimuth & electrical down-tilt angle calibration',
          guidance: 'Measure compass azimuth and RET down-tilt angle against cell planning sheet.',
        ),
        (
          title: 'VSWR swept frequency test (< 1.30:1)',
          guidance: 'Capture Site Master sweep trace verifying feeder return loss > 18 dB.',
        ),
        (
          title: 'Feeder jumper weatherproofing cold-shrink wrap',
          guidance: 'Verify 3-layer weatherproofing on DIN / 4.3-10 connector junctions.',
        ),
      ];
    } else if (cat.contains('optical') ||
        cat.contains('fiber') ||
        title.contains('splicing') ||
        title.contains('trenching')) {
      prefix = 'FBR';
      items = const [
        (
          title: 'Duct continuity & microduct pull-wire check',
          guidance: 'Verify unobstructed duct path and install pull wire with seal caps.',
        ),
        (
          title: 'Precision optical fiber cleave & fusion splice (< 0.05 dB)',
          guidance: 'Photograph fusion splicer display showing estimated core loss.',
        ),
        (
          title: 'OTDR bi-directional insertion loss & reflection test',
          guidance: 'Capture 1310/1550nm OTDR trace on optical span confirming event losses.',
        ),
        (
          title: 'Splice tray cassette sealing & buffer tube slack routing',
          guidance: 'Inspect bend radius in splice enclosure and seal moisture rubber grommets.',
        ),
      ];
    } else if (cat.contains('power') ||
        cat.contains('electrical') ||
        title.contains('battery') ||
        title.contains('dg') ||
        title.contains('earthing') ||
        title.contains('ats')) {
      prefix = 'PWR';
      items = const [
        (
          title: 'Lockout-Tagout (LOTO) isolation & safety clearance',
          guidance: 'Ensure breakers locked, hazard tags attached, and verify zero voltage.',
        ),
        (
          title: 'Battery bank string voltage & internal resistance test',
          guidance: 'Record individual 2V/12V cell float voltages and internal resistance.',
        ),
        (
          title: 'Automatic Transfer Switch (ATS) emergency failover drill',
          guidance: 'Test mains failure simulation and record DG start and transfer delay.',
        ),
        (
          title: 'Earthing pit electrode resistance measurement (< 5 Ohms)',
          guidance: 'Measure earth pit resistance with 3-point earth tester and log reading.',
        ),
      ];
    } else if (cat.contains('solar') ||
        cat.contains('green') ||
        cat.contains('energy') ||
        cat.contains('renewable')) {
      prefix = 'SOL';
      items = const [
        (
          title: 'Solar PV panel open-circuit voltage (Voc) verification',
          guidance: 'Measure string Voc with multimeter under sunlight; match design curve.',
        ),
        (
          title: 'MPPT charge controller firmware & output calibration',
          guidance: 'Verify charging stages (Bulk, Absorption, Float) and display readouts.',
        ),
        (
          title: 'Battery thermal chamber environmental insulation check',
          guidance: 'Inspect enclosure seals, ventilation fan filters, and temperature sensors.',
        ),
        (
          title: 'High-altitude structural mount wind-load torque inspection',
          guidance: 'Check PV panel clamp torque and foundation mounting structure security.',
        ),
      ];
    } else if (cat.contains('transmission') ||
        title.contains('microwave') ||
        title.contains('los') ||
        title.contains('vsat')) {
      prefix = 'TX';
      items = const [
        (
          title: 'Microwave dish antenna alignment & peak RSL search',
          guidance: 'Fine-tune dish pan and tilt to peak received signal level (RSL).',
        ),
        (
          title: 'Bit Error Rate (BER) & Carrier-to-Noise (C/N) verification',
          guidance: 'Log modem performance stats showing zero frame errors over 15 min.',
        ),
        (
          title: 'Waveguide flange weatherproofing & grounding kit installation',
          guidance: 'Bond waveguide grounding kit to tower bus bar and seal flange joints.',
        ),
      ];
    } else {
      prefix = 'CHK';
      items = const [
        (
          title: 'Pre-installation survey & safety clearance',
          guidance: 'Perform site risk assessment, hazard clearance, and tool calibration check.',
        ),
        (
          title: 'Equipment mounting alignment & torque verification',
          guidance: 'Verify structural rack mounting and bolt tightness to specifications.',
        ),
        (
          title: 'Feeder cable grounding and weatherproofing',
          guidance: 'Install grounding kits at top, bottom, and entry point with weather seals.',
        ),
        (
          title: 'Overall site cleanup & handover inspection',
          guidance: 'Ensure all scrap removed, cabinet locked, and site ready for commissioning.',
        ),
      ];
    }

    final completedCount = task.completedChecklistCount.clamp(0, items.length);

    return List.generate(items.length, (i) {
      final isDone = i < completedCount;
      return ChecklistItem(
        id: 'item_${task.id}_${i + 1}',
        itemNumber: '$prefix.${(i + 1).toString().padLeft(2, '0')}',
        title: items[i].title,
        guidanceText: items[i].guidance,
        isRequired: true,
        evidenceRequired: true,
        minPhotos: 1,
        isCompleted: isDone,
        verdict: isDone ? 'PASS' : 'PENDING',
      );
    });
  }
}
